import { hashPassword, verifyPassword, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";

import { createApp } from "../app.ts";
import { SESSION_COOKIE, type ResetTokenStore } from "./routes.ts";

let active: User;

class MemoryResetTokens implements ResetTokenStore {
  readonly #tokens = new Map<string, { username: string; expiresAt: number }>();
  readonly #ttlMs: number;
  #counter = 0;

  constructor(ttlMs = 60_000) {
    this.#ttlMs = ttlMs;
  }

  create(username: string): Promise<string> {
    this.#counter += 1;
    const token = `token-${this.#counter}`;
    this.#tokens.set(token, { username, expiresAt: Date.now() + this.#ttlMs });
    return Promise.resolve(token);
  }

  consume(token: string): Promise<string | undefined> {
    const entry = this.#tokens.get(token);
    if (!entry) {
      return Promise.resolve(undefined);
    }
    this.#tokens.delete(token);
    return Promise.resolve(entry.expiresAt > Date.now() ? entry.username : undefined);
  }
}

beforeEach(async () => {
  active = {
    username: "ada",
    id: "11111111-1111-1111-1111-111111111111",
    passwordHash: await hashPassword("lovelace"),
    isAdmin: true,
    firstName: "Ada",
    lastName: "Lovelace",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordChangedAt: "2026-01-01T00:00:00.000Z",
  };
});

interface Harness {
  app: Hono;
  resetTokens: MemoryResetTokens;
  delivered: { username: string; token: string }[];
}

function buildApp(): Harness {
  const resetTokens = new MemoryResetTokens();
  const delivered: { username: string; token: string }[] = [];
  const app = createApp({
    users: {
      getUser: async (username) => (active.username === username ? active : undefined),
      updateUser: async (username, changes) => {
        active = {
          ...active,
          username,
          passwordHash: await hashPassword(changes.password),
          passwordChangedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return active;
      },
    },
    resetTokens,
    deliverReset: (username, token) => {
      delivered.push({ username, token });
    },
    jwtSecret: "test-secret",
    secureCookies: false,
  });
  return { app, resetTokens, delivered };
}

function requestReset(app: Hono, body: unknown) {
  return app.request("/auth/reset/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function confirmReset(app: Hono, body: unknown) {
  return app.request("/auth/reset/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

it("creates and delivers a reset token for an existing user", async () => {
  const { app, delivered } = buildApp();

  const response = await requestReset(app, { username: "ada" });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
  expect(delivered).toEqual([{ username: "ada", token: "token-1" }]);
});

it("returns the same response for an unknown username without creating a token", async () => {
  const { app, delivered } = buildApp();

  const known = await requestReset(app, { username: "ada" });
  const unknown = await requestReset(app, { username: "nobody" });

  expect(unknown.status).toBe(known.status);
  await expect(unknown.json()).resolves.toEqual(await known.json());
  expect(delivered).toEqual([{ username: "ada", token: "token-1" }]);
});

it("requires a username", async () => {
  const { app } = buildApp();

  const response = await requestReset(app, {});

  expect(response.status).toBe(400);
});

it("updates the password hash when confirming a valid token", async () => {
  const { app } = buildApp();
  await requestReset(app, { username: "ada" });

  const response = await confirmReset(app, { token: "token-1", password: "new-lovelace" });

  expect(response.status).toBe(200);
  expect(await verifyPassword("new-lovelace", active.passwordHash)).toBe(true);
  expect(await verifyPassword("lovelace", active.passwordHash)).toBe(false);
});

it("rejects an unknown reset token without changing the password", async () => {
  const { app } = buildApp();
  const before = active.passwordHash;

  const response = await confirmReset(app, { token: "nope", password: "new-lovelace" });

  expect(response.status).toBe(400);
  expect(active.passwordHash).toBe(before);
});

it("rejects a reset token that has already been used", async () => {
  const { app } = buildApp();
  await requestReset(app, { username: "ada" });

  const first = await confirmReset(app, { token: "token-1", password: "new-lovelace" });
  const second = await confirmReset(app, { token: "token-1", password: "again-lovelace" });

  expect(first.status).toBe(200);
  expect(second.status).toBe(400);
});

it("rejects an expired reset token", async () => {
  const app = createApp({
    users: {
      getUser: async (username) => (active.username === username ? active : undefined),
      updateUser: async () => active,
    },
    resetTokens: { create: async () => "token-1", consume: async () => undefined },
    jwtSecret: "test-secret",
    secureCookies: false,
  });

  const response = await confirmReset(app, { token: "token-1", password: "new-lovelace" });

  expect(response.status).toBe(400);
});

it("requires a token and a password", async () => {
  const { app } = buildApp();

  const response = await confirmReset(app, { token: "token-1" });

  expect(response.status).toBe(400);
});

it("clears the session cookie after a successful reset", async () => {
  const { app } = buildApp();
  await requestReset(app, { username: "ada" });

  const response = await confirmReset(app, { token: "token-1", password: "new-lovelace" });

  expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
});

it("invalidates existing sessions after a successful reset", async () => {
  const { app } = buildApp();
  const login = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada", password: "lovelace" }),
  });
  const cookie = sessionCookie(login);

  const before = await app.request("/auth/me", { headers: { cookie } });
  expect(before.status).toBe(200);

  await requestReset(app, { username: "ada" });
  await confirmReset(app, { token: "token-1", password: "new-lovelace" });

  const after = await app.request("/auth/me", { headers: { cookie } });
  expect(after.status).toBe(401);
});
