import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dynalite, { type DynaliteServer } from "dynalite";
import { afterAll, beforeAll, expect, it } from "vitest";

import { ContentEntryRepository } from "./entry-repository.ts";
import { ContentEntryValidationError, type ContentType } from "./model.ts";
import { ContentTypeRepository } from "./type-repository.ts";

const TYPES_TABLE = "provisionless-content-types-integration";
const ENTRIES_TABLE = "provisionless-content-entries-integration";

let server: DynaliteServer;
let rawClient: DynamoDBClient;
let types: ContentTypeRepository;
let entries: ContentEntryRepository;
let counter = 0;

function nextSlug(): string {
  counter += 1;
  return `post-${counter}`;
}

function contentType(slug: string): ContentType {
  return {
    slug,
    name: "Post",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "published", type: "boolean" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeAll(async () => {
  server = dynalite({ createTableMs: 0, updateTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine the dynalite port");
  }

  rawClient = new DynamoDBClient({
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${address.port}`,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

  await rawClient.send(
    new CreateTableCommand({
      TableName: TYPES_TABLE,
      AttributeDefinitions: [{ AttributeName: "slug", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "slug", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await rawClient.send(
    new CreateTableCommand({
      TableName: ENTRIES_TABLE,
      AttributeDefinitions: [
        { AttributeName: "type", AttributeType: "S" },
        { AttributeName: "id", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "type", KeyType: "HASH" },
        { AttributeName: "id", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  const client = DynamoDBDocumentClient.from(rawClient);
  types = new ContentTypeRepository({ tableName: TYPES_TABLE, client });
  entries = new ContentEntryRepository({ tableName: ENTRIES_TABLE, client });
});

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TYPES_TABLE })).catch(() => undefined);
  await rawClient.send(new DeleteTableCommand({ TableName: ENTRIES_TABLE })).catch(() => undefined);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

it("creates, reads, updates, and lists content types", async () => {
  const created = await types.put({
    slug: nextSlug(),
    name: "Post",
    fields: [{ name: "title", type: "string", required: true }],
  });

  const stored = await types.get(created.slug);
  expect(stored?.name).toBe("Post");
  expect(stored?.createdAt).toBe(created.createdAt);

  const updated = await types.put({
    slug: created.slug,
    name: "Blog post",
    fields: [{ name: "published", type: "boolean" }],
  });
  expect(updated.createdAt).toBe(created.createdAt);
  expect(updated.name).toBe("Blog post");
  expect((await types.list()).some((type) => type.slug === created.slug)).toBe(true);

  await expect(types.delete(created.slug)).resolves.toBe(true);
  await expect(types.get(created.slug)).resolves.toBeUndefined();
});

it("creates, reads, updates, and deletes entries", async () => {
  const type = contentType(nextSlug());
  await types.put(type);

  const created = await entries.create(type, { title: "Hello", published: false });
  await expect(entries.get(type.slug, created.id)).resolves.toEqual(created);

  const updated = await entries.update(type, created.id, { title: "Updated", published: true });
  expect(updated.id).toBe(created.id);
  expect(updated.createdAt).toBe(created.createdAt);
  expect(updated.values).toEqual({ title: "Updated", published: true });

  await expect(entries.list(type.slug)).resolves.toEqual([updated]);
  await expect(entries.delete(type.slug, created.id)).resolves.toBe(true);
  await expect(entries.get(type.slug, created.id)).resolves.toBeUndefined();
});

it("rejects entries that do not match the schema", async () => {
  const type = contentType(nextSlug());
  await types.put(type);

  await expect(entries.create(type, { title: "Hello", extra: "nope" })).rejects.toBeInstanceOf(
    ContentEntryValidationError,
  );
  await expect(entries.create(type, { published: true })).rejects.toBeInstanceOf(
    ContentEntryValidationError,
  );
  await expect(entries.create(type, { title: 42 })).rejects.toBeInstanceOf(
    ContentEntryValidationError,
  );
});

it("deletes every entry for a type without touching other types", async () => {
  const first = contentType(nextSlug());
  const second = contentType(nextSlug());
  await types.put(first);
  await types.put(second);

  await entries.create(first, { title: "One" });
  await entries.create(first, { title: "Two" });
  const survivor = await entries.create(second, { title: "Keep" });

  await expect(entries.deleteByType(first.slug)).resolves.toBe(2);
  await expect(entries.list(first.slug)).resolves.toEqual([]);
  await expect(entries.list(second.slug)).resolves.toEqual([survivor]);
});
