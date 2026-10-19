import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { expect, it } from "vitest";

import { ContentEntryNotFoundError, ContentEntryRepository } from "./entry-repository.ts";
import { ContentEntryValidationError, type ContentEntry, type ContentType } from "./model.ts";

function createRepository(send: (command: unknown) => Promise<unknown>): ContentEntryRepository {
  const client = { send } as unknown as DynamoDBDocumentClient;
  return new ContentEntryRepository({ tableName: "demo-content-entries", client });
}

const contentType: ContentType = {
  slug: "post",
  name: "Post",
  fields: [
    { name: "title", type: "string", required: true },
    { name: "published", type: "boolean" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const existingEntry: ContentEntry = {
  type: "post",
  id: "11111111-1111-1111-1111-111111111111",
  values: { title: "Hello", published: false },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

interface PutInput {
  input: { Item?: Record<string, unknown> };
}

it("creates an entry after validating its values", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  const entry = await repository.create(contentType, { title: "Hello", published: true });

  expect(entry.type).toBe("post");
  expect(entry.id).toHaveLength(36);
  expect(entry.values).toEqual({ title: "Hello", published: true });
  expect(entry.createdAt).toBe(entry.updatedAt);
  const put = commands.find((command) => command instanceof PutCommand) as PutInput | undefined;
  expect(put?.input.Item?.type).toBe("post");
  expect(put?.input.Item?.values).toEqual({ title: "Hello", published: true });
});

it("rejects invalid values before writing", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  await expect(repository.create(contentType, { title: 42, extra: "nope" })).rejects.toBeInstanceOf(
    ContentEntryValidationError,
  );
  expect(commands).toHaveLength(0);
});

it("updates an entry while preserving its id and createdAt", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    if (command instanceof GetCommand) {
      return { Item: existingEntry };
    }
    return {};
  });

  const updated = await repository.update(contentType, existingEntry.id, {
    title: "Updated",
    published: true,
  });

  expect(updated.id).toBe(existingEntry.id);
  expect(updated.createdAt).toBe(existingEntry.createdAt);
  expect(updated.values).toEqual({ title: "Updated", published: true });
  const put = commands.find((command) => command instanceof PutCommand) as PutInput | undefined;
  expect(put?.input.Item?.updatedAt).toBe(updated.updatedAt);
});

it("rejects updating an unknown entry", async () => {
  const repository = createRepository(async (command) => (command instanceof GetCommand ? {} : {}));

  await expect(
    repository.update(contentType, "missing", { title: "Hello" }),
  ).rejects.toBeInstanceOf(ContentEntryNotFoundError);
});

it("gets and lists entries for a type", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    if (command instanceof GetCommand) {
      return { Item: existingEntry };
    }
    if (command instanceof QueryCommand) {
      return { Items: [existingEntry] };
    }
    return {};
  });

  await expect(repository.get("post", existingEntry.id)).resolves.toEqual(existingEntry);
  await expect(repository.list("post")).resolves.toEqual([existingEntry]);

  const query = commands.find((command) => command instanceof QueryCommand) as
    | {
        input: {
          KeyConditionExpression?: string;
          ExpressionAttributeValues?: Record<string, unknown>;
        };
      }
    | undefined;
  expect(query?.input.KeyConditionExpression).toBe("#type = :type");
  expect(query?.input.ExpressionAttributeValues).toEqual({ ":type": "post" });
});

it("deletes entries individually or by type", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    if (command instanceof QueryCommand) {
      return {
        Items: [existingEntry, { ...existingEntry, id: "22222222-2222-2222-2222-222222222222" }],
      };
    }
    if (command instanceof DeleteCommand) {
      return { Attributes: { id: "deleted" } };
    }
    return {};
  });

  await expect(repository.delete("post", existingEntry.id)).resolves.toBe(true);
  await expect(repository.deleteByType("post")).resolves.toBe(2);

  const deletes = commands.filter((command) => command instanceof DeleteCommand);
  expect(deletes).toHaveLength(3);
});
