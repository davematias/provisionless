import { randomUUID } from "node:crypto";

import {
  hashPassword,
  type ContentEntry,
  type ContentType,
  type ContentTypeInput,
  type User,
} from "@provisionless/core";
import type { Hono } from "hono";
import { beforeAll, beforeEach, expect, it } from "vitest";

import { createApp } from "../app.ts";
import type { UserManagementStore } from "../users/store.ts";
import type { ContentEntryStore, ContentTypeStore } from "./store.ts";

class MemoryContentTypes implements ContentTypeStore {
  readonly types = new Map<string, ContentType>();

  get(slug: string): Promise<ContentType | undefined> {
    return Promise.resolve(this.types.get(slug));
  }

  list(): Promise<ContentType[]> {
    return Promise.resolve([...this.types.values()]);
  }

  put(input: ContentTypeInput): Promise<ContentType> {
    const now = new Date().toISOString();
    const existing = this.types.get(input.slug);
    const contentType: ContentType = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.types.set(input.slug, contentType);
    return Promise.resolve(contentType);
  }

  delete(slug: string): Promise<boolean> {
    return Promise.resolve(this.types.delete(slug));
  }
}

class MemoryContentEntries implements ContentEntryStore {
  readonly entries = new Map<string, ContentEntry>();

  #key(type: string, id: string): string {
    return `${type}:${id}`;
  }

  get(type: string, id: string): Promise<ContentEntry | undefined> {
    return Promise.resolve(this.entries.get(this.#key(type, id)));
  }

  list(type: string): Promise<ContentEntry[]> {
    return Promise.resolve([...this.entries.values()].filter((entry) => entry.type === type));
  }

  create(contentType: ContentType, values: unknown): Promise<ContentEntry> {
    const now = new Date().toISOString();
    const entry: ContentEntry = {
      type: contentType.slug,
      id: randomUUID(),
      values: values as ContentEntry["values"],
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(this.#key(entry.type, entry.id), entry);
    return Promise.resolve(entry);
  }

  update(contentType: ContentType, id: string, values: unknown): Promise<ContentEntry> {
    const existing = this.entries.get(this.#key(contentType.slug, id));
    if (!existing) {
      throw new Error("missing");
    }
    const entry: ContentEntry = {
      ...existing,
      values: values as ContentEntry["values"],
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(this.#key(entry.type, entry.id), entry);
    return Promise.resolve(entry);
  }

  delete(type: string, id: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(this.#key(type, id)));
  }

  deleteByType(type: string): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.entries) {
      if (entry.type === type) {
        this.entries.delete(key);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }
}

let admin: User;
let member: User;
let contentTypes: MemoryContentTypes;
let contentEntries: MemoryContentEntries;
let app: Hono;

beforeAll(async () => {
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
});

beforeEach(async () => {
  admin.passwordHash = await hashPassword("lovelace");
  member.passwordHash = await hashPassword("lovelace");
  contentTypes = new MemoryContentTypes();
  contentEntries = new MemoryContentEntries();
  const users: UserManagementStore = {
    getUser: async (username) =>
      [admin, member].find((candidate) => candidate.username === username),
    createUser: async () => {
      throw new Error("not used");
    },
    listUsers: async () => [admin, member],
    updateUser: async () => admin,
  };
  app = createApp({
    users,
    resetTokens: { create: async () => "token", consume: async () => undefined },
    contentTypes,
    contentEntries,
    jwtSecret: "test-secret",
    secureCookies: false,
  });
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

async function createSchema(slug: string): Promise<string> {
  const cookie = await login("ada");
  const response = await request(cookie, "PUT", `/content-types/${slug}`, {
    name: "Post",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "published", type: "boolean" },
    ],
  });
  expect(response.status).toBe(200);
  return cookie;
}

it("rejects missing required fields and wrong value types before writing", async () => {
  const cookie = await createSchema("post");

  const missing = await request(cookie, "POST", "/content/post", {
    values: { published: true },
  });
  expect(missing.status).toBe(400);
  const missingBody = (await missing.json()) as { errors: { field: string; message: string }[] };
  expect(missingBody.errors).toEqual([{ field: "title", message: "Field is required" }]);

  const wrongType = await request(cookie, "POST", "/content/post", {
    values: { title: 42 },
  });
  expect(wrongType.status).toBe(400);

  expect(contentEntries.entries.size).toBe(0);
});

it("rejects unknown entry fields and missing values", async () => {
  const cookie = await createSchema("post");

  const unknown = await request(cookie, "POST", "/content/post", {
    values: { title: "Hello", extra: true },
  });
  expect(unknown.status).toBe(400);

  const missingValues = await request(cookie, "POST", "/content/post", {});
  expect(missingValues.status).toBe(400);
});

it("rejects invalid schema updates with field errors", async () => {
  const cookie = await login("ada");

  const response = await request(cookie, "PUT", "/content-types/post", {
    name: "",
    fields: [{ name: "title", type: "number" }],
  });

  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string; errors: { field: string }[] };
  expect(body.error).toBe("Invalid content type");
  expect(body.errors.map((error) => error.field)).toEqual(["name", "fields[0].type"]);
});

it("requires a session for content but not an admin, and an admin for schemas", async () => {
  const adminCookie = await createSchema("post");
  const memberCookie = await login("grace");

  expect((await request(undefined, "GET", "/content/post")).status).toBe(401);
  expect((await request(memberCookie, "GET", "/content/post")).status).toBe(200);
  expect((await request(memberCookie, "GET", "/content-types/post")).status).toBe(403);
  expect(
    (await request(memberCookie, "PUT", "/content-types/post", { name: "x", fields: [] })).status,
  ).toBe(403);
  expect((await request(adminCookie, "GET", "/content-types/post")).status).toBe(200);
});
