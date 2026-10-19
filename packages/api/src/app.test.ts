import { hashPassword, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { beforeAll, expect, it } from "vitest";

import { createApp, parseAllowOrigins, parseCookieSameSite } from "./app.ts";
import { SESSION_COOKIE } from "./auth/routes.ts";

let active: User;

beforeAll(async () => {
  active = {
    id: "11111111-1111-1111-1111-111111111111",
    username: "ada",
    email: "ada@example.com",
    isAdmin: true,
    firstName: "Ada",
    lastName: "Lovelace",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordChangedAt: "2026-01-01T00:00:00.000Z",
    passwordHash: await hashPassword("lovelace"),
  };
});

function appWith(deps: Partial<Parameters<typeof createApp>[0]>): Hono {
  return createApp({
    users: {
      getUser: async (username) => (username === active.username ? active : undefined),
      updateUser: async () => undefined,
    },
    resetTokens: { create: async () => "token", consume: async () => undefined },
    jwtSecret: "test-secret",
    secureCookies: false,
    ...deps,
  });
}

function loginRequest(origin?: string): Parameters<Hono["request"]>[1] {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ username: "ada", password: "lovelace" }),
  };
}

it("parses comma-separated allowed origins", () => {
  expect(parseAllowOrigins("https://a.test, https://b.test ,")).toEqual([
    "https://a.test",
    "https://b.test",
  ]);
  expect(parseAllowOrigins(undefined)).toEqual([]);
});

it("defaults the cookie SameSite to Lax and allows None", () => {
  expect(parseCookieSameSite(undefined)).toBe("Lax");
  expect(parseCookieSameSite("None")).toBe("None");
  expect(parseCookieSameSite("garbage")).toBe("Lax");
});

it("answers preflight for an allowed origin with credentials support", async () => {
  const app = appWith({ corsAllowOrigins: ["https://admin.test"] });

  const response = await app.request("/auth/login", {
    method: "OPTIONS",
    headers: { origin: "https://admin.test", "access-control-request-method": "POST" },
  });

  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.test");
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
});

it("sets CORS headers on a cross-origin login from an allowed origin", async () => {
  const app = appWith({ corsAllowOrigins: ["https://admin.test"] });

  const response = await app.request("/auth/login", loginRequest("https://admin.test"));

  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe("https://admin.test");
  expect(response.headers.get("access-control-allow-credentials")).toBe("true");
});

it("omits CORS headers for origins that are not allowed", async () => {
  const app = appWith({ corsAllowOrigins: ["https://admin.test"] });

  const response = await app.request("/auth/login", loginRequest("https://evil.test"));

  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

it("does not add CORS headers when no origins are configured", async () => {
  const app = appWith({});

  const response = await app.request("/auth/login", loginRequest("https://admin.test"));

  expect(response.headers.get("access-control-allow-origin")).toBeNull();
});

it("issues the session cookie with SameSite=Lax by default", async () => {
  const app = appWith({});

  const response = await app.request("/auth/login", loginRequest());

  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`${SESSION_COOKIE}=`);
  expect(cookie).toContain("SameSite=Lax");
});

it("forces Secure on SameSite=None cookies for cross-site use", async () => {
  const app = appWith({ cookieSameSite: "None", secureCookies: false });

  const response = await app.request("/auth/login", loginRequest("https://admin.test"));

  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("SameSite=None");
  expect(cookie).toContain("Secure");
});
