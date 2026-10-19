import { hashPassword, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { beforeAll, beforeEach, expect, it } from "vitest";

import { createApp } from "../app.ts";
import type { ResetTokenStore } from "./routes.ts";

class MemoryResetTokens implements ResetTokenStore {
  readonly tokens = new Map<string, string>();
  #counter = 0;

  create(username: string): Promise<string> {
    this.#counter += 1;
    const token = `token-${this.#counter}`;
    this.tokens.set(token, username);
    return Promise.resolve(token);
  }

  consume(token: string): Promise<string | undefined> {
    const username = this.tokens.get(token);
    this.tokens.delete(token);
    return Promise.resolve(username);
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

interface Harness {
  app: Hono;
  resetTokens: MemoryResetTokens;
  delivered: { username: string; token: string }[];
}

function buildApp(): Harness {
  const resetTokens = new MemoryResetTokens();
  const delivered: { username: string; token: string }[] = [];
  const users = [admin, member];
  const app = createApp({
    users: {
      getUser: async (username) => users.find((user) => user.username === username),
      updateUser: async (username, changes) => {
        const user = users.find((candidate) => candidate.username === username);
        if (user) {
          user.passwordHash = await hashPassword(changes.password);
          user.passwordChangedAt = new Date().toISOString();
        }
        return user;
      },
    },
    resetTokens,
    deliverReset: (user, token) => {
      delivered.push({ username: user.username, token });
    },
    adminBaseUrl: "https://admin.example.com/",
    jwtSecret: "test-secret",
    secureCookies: false,
  });
  return { app, resetTokens, delivered };
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

function requestLink(app: Hono, cookie: string | undefined, body: unknown) {
  return app.request("/auth/reset/link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

it("lets an admin create a shareable reset link without sending email", async () => {
  const { app, resetTokens, delivered } = buildApp();
  const cookie = await login(app, "ada");

  const response = await requestLink(app, cookie, { username: "grace" });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    username: "grace",
    url: "https://admin.example.com/reset?token=token-1",
  });
  await expect(resetTokens.consume("token-1")).resolves.toBe("grace");
  expect(delivered).toEqual([]);
});

it("creates a token that can complete the reset flow", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");
  const response = await requestLink(app, cookie, { username: "ada" });
  const body = (await response.json()) as { url: string };
  const token = new URL(body.url).searchParams.get("token");

  const confirm = await app.request("/auth/reset/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password: "new-lovelace" }),
  });

  expect(confirm.status).toBe(200);
});

it("requires a username", async () => {
  const { app } = buildApp();
  const cookie = await login(app, "ada");

  const response = await requestLink(app, cookie, {});

  expect(response.status).toBe(400);
});

it("returns 404 for an unknown username without creating a token", async () => {
  const { app, resetTokens } = buildApp();
  const cookie = await login(app, "ada");

  const response = await requestLink(app, cookie, { username: "nobody" });

  expect(response.status).toBe(404);
  expect(resetTokens.tokens.size).toBe(0);
});

it("rejects non-admin users", async () => {
  const { app, resetTokens } = buildApp();
  const cookie = await login(app, "grace");

  const response = await requestLink(app, cookie, { username: "ada" });

  expect(response.status).toBe(403);
  expect(resetTokens.tokens.size).toBe(0);
});

it("rejects unauthenticated callers", async () => {
  const { app, resetTokens } = buildApp();

  const response = await requestLink(app, undefined, { username: "ada" });

  expect(response.status).toBe(401);
  expect(resetTokens.tokens.size).toBe(0);
});
