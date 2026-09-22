import { hashPassword, type User } from "@provisionless/core";
import { Hono } from "hono";
import { beforeAll, beforeEach, expect, it } from "vitest";

import { signSession } from "./jwt.ts";
import { requireAuth } from "./middleware.ts";
import { SESSION_COOKIE, type AppEnv } from "./session.ts";

let user: User;

beforeAll(async () => {
  user = {
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

beforeEach(() => {
  user.enabled = true;
  user.passwordChangedAt = "2026-01-01T00:00:00.000Z";
});

function appWith(current: User | undefined): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use(
    "/protected",
    requireAuth({ users: { getUser: async () => current }, jwtSecret: "test-secret" }),
  );
  app.get("/protected", (c) => c.json({ username: c.get("user").username }));
  return app;
}

function sessionToken(passwordChangedAt = user.passwordChangedAt): Promise<string> {
  return signSession({ username: user.username, passwordChangedAt }, "test-secret", 3600);
}

it("allows a valid session and attaches the user to the context", async () => {
  const token = await sessionToken();

  const response = await appWith(user).request("/protected", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ username: "ada" });
});

it("rejects a request with no session", async () => {
  const response = await appWith(user).request("/protected");
  expect(response.status).toBe(401);
});

it("rejects a tampered token", async () => {
  const response = await appWith(user).request("/protected", {
    headers: { cookie: `${SESSION_COOKIE}=not-a-real-token` },
  });
  expect(response.status).toBe(401);
});

it("rejects a disabled user", async () => {
  const token = await sessionToken();
  user.enabled = false;

  const response = await appWith(user).request("/protected", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  expect(response.status).toBe(401);
});

it("rejects a session issued before the password changed", async () => {
  const token = await sessionToken();
  user.passwordChangedAt = "2026-06-01T00:00:00.000Z";

  const response = await appWith(user).request("/protected", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  expect(response.status).toBe(401);
});
