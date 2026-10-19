import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { expect, it } from "vitest";

import { ContentTypeValidationError, type ContentType } from "./model.ts";
import { ContentTypeRepository } from "./type-repository.ts";

function createRepository(send: (command: unknown) => Promise<unknown>): ContentTypeRepository {
  const client = { send } as unknown as DynamoDBDocumentClient;
  return new ContentTypeRepository({ tableName: "demo-content-types", client });
}

const input = {
  slug: "post",
  name: "Post",
  fields: [
    { name: "title", type: "string" as const, required: true },
    { name: "published", type: "boolean" as const },
  ],
};

interface PutInput {
  input: { Item?: Record<string, unknown> };
}

it("creates a content type with timestamps", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  const type = await repository.put(input);

  expect(type.slug).toBe("post");
  expect(type.createdAt).toBe(type.updatedAt);
  const put = commands.find((command) => command instanceof PutCommand) as PutInput | undefined;
  expect(put?.input.Item?.slug).toBe("post");
  expect(put?.input.Item?.fields).toEqual(input.fields);
});

it("preserves createdAt when updating an existing type", async () => {
  const commands: unknown[] = [];
  const existing: ContentType = {
    ...input,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const repository = createRepository(async (command) => {
    commands.push(command);
    if (command instanceof GetCommand) {
      return { Item: existing };
    }
    return {};
  });

  const updated = await repository.put({ ...input, name: "Blog post" });

  expect(updated.createdAt).toBe(existing.createdAt);
  expect(updated.name).toBe("Blog post");
  expect(updated.updatedAt >= existing.updatedAt).toBe(true);
});

it("rejects an invalid schema before writing", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  await expect(repository.put({ slug: "Bad Slug", name: "", fields: [] })).rejects.toBeInstanceOf(
    ContentTypeValidationError,
  );
  expect(commands).toHaveLength(0);
});

it("gets a type by slug", async () => {
  const repository = createRepository(async (command) =>
    command instanceof GetCommand ? { Item: { slug: "post", name: "Post" } } : {},
  );

  const type = await repository.get("post");

  expect(type?.slug).toBe("post");
});

it("lists content types", async () => {
  const repository = createRepository(async (command) =>
    command instanceof ScanCommand ? { Items: [{ slug: "post" }, { slug: "page" }] } : {},
  );

  const types = await repository.list();

  expect(types.map((type) => type.slug)).toEqual(["post", "page"]);
});

it("reports whether a type was deleted", async () => {
  const repository = createRepository(async (command) => {
    if (command instanceof DeleteCommand) {
      return { Attributes: { slug: "post" } };
    }
    return {};
  });

  await expect(repository.delete("post")).resolves.toBe(true);
});
