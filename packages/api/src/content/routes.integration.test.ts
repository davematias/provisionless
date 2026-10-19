import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  createContentEntryRepository,
  createContentTypeRepository,
  hashPassword,
  type NewUser,
  type UpdateUserInput,
  type User,
} from "@provisionless/core";
import dynalite, { type DynaliteServer } from "dynalite";
import type { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { createApp } from "../app.ts";
import type { UserManagementStore } from "../users/store.ts";

const TYPES_TABLE = "provisionless-api-content-types-integration";
const ENTRIES_TABLE = "provisionless-api-content-entries-integration";

class MemoryUserStore implements UserManagementStore {
  readonly users: User[];

  constructor(users: User[]) {
    this.users = users.map((user) => ({ ...user }));
  }

  getUser(username: string): Promise<User | undefined> {
    return Promise.resolve(this.users.find((user) => user.username === username));
  }

  createUser(input: NewUser): Promise<User> {
    const now = new Date().toISOString();
    const user: User = {
      username: input.username,
      id: crypto.randomUUID(),
      passwordHash: input.password,
      email: input.email,
      isAdmin: input.isAdmin,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    };
    this.users.push(user);
    return Promise.resolve(user);
  }

  listUsers(): Promise<User[]> {
    return Promise.resolve([...this.users]);
  }

  updateUser(username: string, changes: UpdateUserInput): Promise<User> {
    const user = this.users.find((candidate) => candidate.username === username);
    if (!user) {
      throw new Error(`Unknown user ${username}`);
    }
    Object.assign(user, changes);
    user.updatedAt = new Date().toISOString();
    return Promise.resolve(user);
  }
}

let server: DynaliteServer;
let rawClient: DynamoDBClient;
let app: Hono;
let counter = 0;

let admin: User;
let member: User;

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
  const base = {
    passwordHash: await hashPassword("lovelace"),
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordChangedAt: "2026-01-01T00:00:00.000Z",
  };
  admin = {
    ...base,
    username: "ada",
    id: "11111111-1111-1111-1111-111111111111",
    isAdmin: true,
  };
  member = {
    ...base,
    username: "grace",
    id: "22222222-2222-2222-2222-222222222222",
    email: "grace@example.com",
    isAdmin: false,
  };

  app = createApp({
    users: new MemoryUserStore([admin, member]),
    resetTokens: { create: async () => "token", consume: async () => undefined },
    contentTypes: createContentTypeRepository(TYPES_TABLE, client),
    contentEntries: createContentEntryRepository(ENTRIES_TABLE, client),
    jwtSecret: "test-secret",
    secureCookies: false,
  });
});

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TYPES_TABLE })).catch(() => undefined);
  await rawClient.send(new DeleteTableCommand({ TableName: ENTRIES_TABLE })).catch(() => undefined);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(async () => {
  admin.passwordHash = await hashPassword("lovelace");
  member.passwordHash = await hashPassword("lovelace");
  admin.passwordChangedAt = "2026-01-01T00:00:00.000Z";
  member.passwordChangedAt = "2026-01-01T00:00:00.000Z";
});

async function login(username: string): Promise<string> {
  const response = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "lovelace" }),
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

function request(cookie: string | undefined, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function nextSlug(): string {
  counter += 1;
  return `post-${counter}`;
}

async function createSchema(cookie: string, slug: string, required = true): Promise<void> {
  const response = await request(cookie, "PUT", `/content-types/${slug}`, {
    name: "Post",
    fields: [
      { name: "title", type: "string", required },
      { name: "published", type: "boolean" },
    ],
  });
  expect(response.status).toBe(200);
}

it("lets an admin create, read, and update a schema", async () => {
  const cookie = await login("ada");
  const slug = nextSlug();

  await createSchema(cookie, slug);
  const fetched = await request(cookie, "GET", `/content-types/${slug}`);
  expect(fetched.status).toBe(200);
  const body = (await fetched.json()) as { contentType: { slug: string; name: string } };
  expect(body.contentType.slug).toBe(slug);
  expect(body.contentType.name).toBe("Post");

  const updated = await request(cookie, "PUT", `/content-types/${slug}`, {
    name: "Blog post",
    fields: [{ name: "title", type: "string", required: false }],
  });
  expect(updated.status).toBe(200);
  const updatedBody = (await updated.json()) as { contentType: { name: string } };
  expect(updatedBody.contentType.name).toBe("Blog post");
});

it("rejects invalid schemas and non-admin schema access", async () => {
  const adminCookie = await login("ada");
  const memberCookie = await login("grace");
  const slug = nextSlug();

  expect((await request(undefined, "GET", `/content-types/${slug}`)).status).toBe(401);
  expect((await request(memberCookie, "GET", `/content-types/${slug}`)).status).toBe(403);
  expect(
    (
      await request(memberCookie, "PUT", `/content-types/${slug}`, {
        name: "Post",
        fields: [],
      })
    ).status,
  ).toBe(403);

  const invalid = await request(adminCookie, "PUT", `/content-types/${slug}`, {
    name: "",
    fields: [{ name: "title", type: "number" }],
  });
  expect(invalid.status).toBe(400);
  const body = (await invalid.json()) as { errors: unknown[] };
  expect(body.errors.length).toBeGreaterThan(0);
});

it("creates, lists, reads, updates, and deletes entries", async () => {
  const adminCookie = await login("ada");
  const memberCookie = await login("grace");
  const slug = nextSlug();
  await createSchema(adminCookie, slug);

  const created = await request(memberCookie, "POST", `/content/${slug}`, {
    values: { title: "Hello", published: false },
  });
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as {
    entry: { id: string; values: Record<string, unknown> };
  };
  expect(createdBody.entry.values).toEqual({ title: "Hello", published: false });

  const listed = await request(memberCookie, "GET", `/content/${slug}`);
  expect(listed.status).toBe(200);
  const listedBody = (await listed.json()) as { entries: unknown[] };
  expect(listedBody.entries).toHaveLength(1);

  const fetched = await request(memberCookie, "GET", `/content/${slug}/${createdBody.entry.id}`);
  expect(fetched.status).toBe(200);

  const updated = await request(memberCookie, "PUT", `/content/${slug}/${createdBody.entry.id}`, {
    values: { title: "Updated", published: true },
  });
  expect(updated.status).toBe(200);
  const updatedBody = (await updated.json()) as {
    entry: { values: Record<string, unknown> };
  };
  expect(updatedBody.entry.values).toEqual({ title: "Updated", published: true });

  const deleted = await request(memberCookie, "DELETE", `/content/${slug}/${createdBody.entry.id}`);
  expect(deleted.status).toBe(200);
  expect(
    (await request(memberCookie, "GET", `/content/${slug}/${createdBody.entry.id}`)).status,
  ).toBe(404);
});

it("rejects entries that do not match the schema", async () => {
  const cookie = await login("ada");
  const slug = nextSlug();
  await createSchema(cookie, slug);

  const missing = await request(cookie, "POST", `/content/${slug}`, {
    values: { published: true },
  });
  expect(missing.status).toBe(400);
  const missingBody = (await missing.json()) as { errors: { field: string }[] };
  expect(missingBody.errors.map((error) => error.field)).toContain("title");

  const wrongType = await request(cookie, "POST", `/content/${slug}`, {
    values: { title: 42 },
  });
  expect(wrongType.status).toBe(400);

  const noValues = await request(cookie, "POST", `/content/${slug}`, {});
  expect(noValues.status).toBe(400);
});

it("rejects unauthenticated content access and unknown types or entries", async () => {
  const cookie = await login("ada");
  const slug = nextSlug();
  await createSchema(cookie, slug);

  expect((await request(undefined, "GET", `/content/${slug}`)).status).toBe(401);
  expect((await request(cookie, "GET", "/content/missing")).status).toBe(404);
  expect((await request(cookie, "GET", `/content/${slug}/missing`)).status).toBe(404);
  expect(
    (await request(cookie, "PUT", `/content/${slug}/missing`, { values: { title: "Hi" } })).status,
  ).toBe(404);
  expect((await request(cookie, "DELETE", `/content/${slug}/missing`)).status).toBe(404);
});

it("deletes a schema together with its entries", async () => {
  const cookie = await login("ada");
  const slug = nextSlug();
  await createSchema(cookie, slug);
  await request(cookie, "POST", `/content/${slug}`, { values: { title: "One" } });
  await request(cookie, "POST", `/content/${slug}`, { values: { title: "Two" } });

  const deleted = await request(cookie, "DELETE", `/content-types/${slug}`);
  expect(deleted.status).toBe(200);

  expect((await request(cookie, "GET", `/content-types/${slug}`)).status).toBe(404);
  expect((await request(cookie, "GET", `/content/${slug}`)).status).toBe(404);
  expect((await request(cookie, "DELETE", `/content-types/${slug}`)).status).toBe(404);
});
