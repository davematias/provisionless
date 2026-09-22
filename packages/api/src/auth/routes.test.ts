import { hashPassword, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { beforeAll, expect, it } from "vitest";

import { createApp } from "../app.ts";
import { SESSION_COOKIE } from "./routes.ts";

let active: User;
let disabled: User;

beforeAll(async () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    isAdmin: true,
    firstName: "Ada",
    lastName: "Lovelace",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordHash: await hashPassword("lovelace"),
  };
  active = { ...base, username: "ada" };
  disabled = {
    ...base,
    id: "22222222-2222-2222-2222-222222222222",
    username: "disabled",
    enabled: false,
  };
});

function appWith(user: User | undefined): Hono {
  return createApp({
    users: {
      getUser: async (username) => (user && user.username === username ? user : undefined),
    },
    jwtSecret: "test-secret",
    secureCookies: false,
  });
}

function login(app: Hono, body: unknown) {
  return app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

it("logs in with valid credentials and sets a session cookie", async () => {
  const response = await login(appWith(active), { username: "ada", password: "lovelace" });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: Record<string, unknown> };
  expect(body.user.username).toBe("ada");
  expect(body.user).not.toHaveProperty("passwordHash");

  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(SESSION_COOKIE);
  expect(cookie.toLowerCase()).toContain("httponly");
});

it("rejects a wrong password", async () => {
  const response = await login(appWith(active), { username: "ada", password: "wrong" });
  expect(response.status).toBe(401);
});

it("rejects an unknown user", async () => {
  const response = await login(appWith(active), { username: "nobody", password: "lovelace" });
  expect(response.status).toBe(401);
});

it("rejects a disabled user", async () => {
  const response = await login(appWith(disabled), { username: "disabled", password: "lovelace" });
  expect(response.status).toBe(401);
});

it("requires a username and password", async () => {
  const response = await login(appWith(active), { username: "ada" });
  expect(response.status).toBe(400);
});

it("returns the current user for a valid session and refreshes the cookie", async () => {
  const app = appWith(active);
  const loginResponse = await login(app, { username: "ada", password: "lovelace" });

  const response = await app.request("/auth/me", {
    headers: { cookie: sessionCookie(loginResponse) },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { username: string } };
  expect(body.user.username).toBe("ada");
  expect(response.headers.get("set-cookie")).toContain(SESSION_COOKIE);
});

it("rejects /auth/me without a session", async () => {
  const response = await appWith(active).request("/auth/me");
  expect(response.status).toBe(401);
});

it("rejects /auth/me with a tampered token", async () => {
  const response = await appWith(active).request("/auth/me", {
    headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` },
  });
  expect(response.status).toBe(401);
});

it("logs out by clearing the cookie", async () => {
  const response = await appWith(active).request("/auth/logout", { method: "POST" });

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
});
