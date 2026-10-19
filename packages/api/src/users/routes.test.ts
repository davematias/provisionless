import { randomUUID } from "node:crypto";

import {
  hashPassword,
  UsernameTakenError,
  verifyPassword,
  type NewUser,
  type UpdateUserInput,
  type User,
} from "@provisionless/core";
import type { Hono } from "hono";
import { beforeAll, beforeEach, expect, it } from "vitest";

import { createApp } from "../app.ts";
import type { UserManagementStore } from "./store.ts";

class MemoryUserStore implements UserManagementStore {
  readonly users: User[];

  constructor(users: User[]) {
    this.users = users.map((user) => ({ ...user }));
  }

  getUser(username: string): Promise<User | undefined> {
    return Promise.resolve(this.users.find((user) => user.username === username));
  }

  async createUser(input: NewUser): Promise<User> {
    if (this.users.some((user) => user.username === input.username)) {
      throw new UsernameTakenError(input.username);
    }
    const now = new Date().toISOString();
    const user: User = {
      username: input.username,
      id: randomUUID(),
      passwordHash: await hashPassword(input.password),
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
    return user;
  }

  listUsers(): Promise<User[]> {
    return Promise.resolve([...this.users]);
  }

  async updateUser(username: string, changes: UpdateUserInput): Promise<User> {
    const user = this.users.find((candidate) => candidate.username === username);
    if (!user) {
      throw new Error(`Unknown user ${username}`);
    }
    if (changes.email !== undefined) user.email = changes.email;
    if (changes.firstName !== undefined) user.firstName = changes.firstName;
    if (changes.lastName !== undefined) user.lastName = changes.lastName;
    if (changes.pictureUrl !== undefined) user.pictureUrl = changes.pictureUrl;
    if (changes.isAdmin !== undefined) user.isAdmin = changes.isAdmin;
    if (changes.enabled !== undefined) user.enabled = changes.enabled;
    if (changes.password !== undefined) {
      user.passwordHash = await hashPassword(changes.password);
      user.passwordChangedAt = new Date().toISOString();
    }
    user.updatedAt = new Date().toISOString();
    return user;
  }
}

let admin: User;
let member: User;

beforeAll(async () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    passwordHash: await hashPassword("lovelace"),
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordChangedAt: "2026-01-01T00:00:00.000Z",
  };
  admin = { ...base, username: "ada", isAdmin: true };
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
  admin.passwordChangedAt = "2026-01-01T00:00:00.000Z";
  member.passwordChangedAt = "2026-01-01T00:00:00.000Z";
});

function buildApp(): { app: Hono; store: MemoryUserStore } {
  const store = new MemoryUserStore([admin, member]);
  const app = createApp({
    users: store,
    resetTokens: { create: async () => "token", consume: async () => undefined },
    jwtSecret: "test-secret",
    secureCookies: false,
  });
  return { app, store };
}

async function login(app: Hono, username: string): Promise<string> {
  const response = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "lovelace" }),
  });
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

function request(
  app: Hono,
  cookie: string | undefined,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const newUser = {
  username: "linus",
  password: "tux",
  email: "linus@example.com",
  firstName: "Linus",
  lastName: "Torvalds",
  isAdmin: false,
  enabled: true,
};

it("lists users for an admin without password data", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "GET", "/users");

  expect(response.status).toBe(200);
  const body = (await response.json()) as { users: Record<string, unknown>[] };
  expect(body.users.map((user) => user.username)).toEqual(["ada", "grace"]);
  expect(body.users[0]).not.toHaveProperty("passwordHash");
  expect(body.users[0]).not.toHaveProperty("passwordChangedAt");
  expect(body.users[0]?.email).toBe("ada@example.com");
});

it("creates a user with a hashed password and returns only public fields", async () => {
  const { app, store } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "POST", "/users", newUser);

  expect(response.status).toBe(201);
  const body = (await response.json()) as { user: Record<string, unknown> };
  expect(body.user.username).toBe("linus");
  expect(body.user.email).toBe("linus@example.com");
  expect(body.user).not.toHaveProperty("passwordHash");
  expect(body.user).not.toHaveProperty("passwordChangedAt");
  expect(body.user).not.toHaveProperty("password");

  const created = await store.getUser("linus");
  expect(created).toBeDefined();
  expect(await verifyPassword("tux", created?.passwordHash ?? "")).toBe(true);
});

it("defaults new users to enabled and non-admin", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "POST", "/users", {
    username: "grace2",
    password: "hopper",
    email: "grace2@example.com",
    firstName: "Grace",
    lastName: "Hopper",
  });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { user: Record<string, unknown> };
  expect(body.user.enabled).toBe(true);
  expect(body.user.isAdmin).toBe(false);
});

it("rejects a duplicate username", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "POST", "/users", {
    ...newUser,
    username: "grace",
  });

  expect(response.status).toBe(409);
});

it("rejects an invalid email address", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "POST", "/users", {
    ...newUser,
    email: "not-an-email",
  });

  expect(response.status).toBe(400);
});

it("requires all create fields", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "POST", "/users", {
    username: "linus",
    password: "tux",
  });

  expect(response.status).toBe(400);
});

it("enables, disables, and changes admin status", async () => {
  const { app, store } = buildApp();
  const cookie = await login(app, "ada");

  const disabled = await request(app, cookie, "PATCH", "/users/grace", {
    enabled: false,
    isAdmin: true,
  });

  expect(disabled.status).toBe(200);
  const body = (await disabled.json()) as { user: Record<string, unknown> };
  expect(body.user.enabled).toBe(false);
  expect(body.user.isAdmin).toBe(true);
  expect(body.user).not.toHaveProperty("passwordHash");

  const updated = await store.getUser("grace");
  expect(updated?.enabled).toBe(false);
  expect(updated?.isAdmin).toBe(true);
});

it("updates profile fields and email", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "PATCH", "/users/grace", {
    firstName: "Grace",
    lastName: "Murray Hopper",
    email: "grace.hopper@example.com",
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: Record<string, unknown> };
  expect(body.user.lastName).toBe("Murray Hopper");
  expect(body.user.email).toBe("grace.hopper@example.com");
});

it("returns 404 when updating an unknown user", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await request(app, cookie, "PATCH", "/users/nobody", { enabled: false });

  expect(response.status).toBe(404);
});

it("rejects invalid update values", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  expect((await request(app, cookie, "PATCH", "/users/grace", { enabled: "no" })).status).toBe(400);
  expect((await request(app, cookie, "PATCH", "/users/grace", { email: "nope" })).status).toBe(400);
  expect((await request(app, cookie, "PATCH", "/users/grace", {})).status).toBe(400);
});

it("rejects non-admin callers on every route", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "grace");

  expect((await request(app, cookie, "GET", "/users")).status).toBe(403);
  expect((await request(app, cookie, "POST", "/users", newUser)).status).toBe(403);
  expect((await request(app, cookie, "PATCH", "/users/ada", { enabled: false })).status).toBe(403);
});

it("rejects unauthenticated callers on every route", async () => {
  const { app } = buildApp();

  expect((await request(app, undefined, "GET", "/users")).status).toBe(401);
  expect((await request(app, undefined, "POST", "/users", newUser)).status).toBe(401);
  expect((await request(app, undefined, "PATCH", "/users/ada", { enabled: false })).status).toBe(
    401,
  );
});
