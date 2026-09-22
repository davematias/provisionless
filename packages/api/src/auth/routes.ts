import { toPublicUser, verifyPassword, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { signSession, verifySession } from "./jwt.ts";

export const SESSION_COOKIE = "provisionless_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface AuthDependencies {
  users: { getUser(username: string): Promise<User | undefined> };
  jwtSecret: string;
  secureCookies?: boolean;
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

function extractCredentials(body: unknown): { username: string; password: string } | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { username, password } = body as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || username.trim() === "" || typeof password !== "string") {
    return undefined;
  }
  return { username: username.trim(), password };
}

export function registerAuthRoutes(app: Hono, deps: AuthDependencies): void {
  const secure = deps.secureCookies ?? true;

  app.post("/auth/login", async (c) => {
    const credentials = extractCredentials(await c.req.json().catch(() => undefined));
    if (!credentials) {
      return c.json({ error: "username and password are required" }, 400);
    }

    const user = await deps.users.getUser(credentials.username);
    const valid =
      user !== undefined &&
      user.enabled &&
      (await verifyPassword(credentials.password, user.passwordHash));
    if (!user || !valid) {
      return c.json({ error: "Invalid username or password" }, 401);
    }

    const token = await signSession(user.username, deps.jwtSecret, SESSION_TTL_SECONDS);
    setCookie(c, SESSION_COOKIE, token, cookieOptions(secure));
    return c.json({ user: toPublicUser(user) });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/auth/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await verifySession(token, deps.jwtSecret) : undefined;
    const user = session ? await deps.users.getUser(session.username) : undefined;
    if (!session || !user || !user.enabled) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const refreshed = await signSession(user.username, deps.jwtSecret, SESSION_TTL_SECONDS);
    setCookie(c, SESSION_COOKIE, refreshed, cookieOptions(secure));
    return c.json({ user: toPublicUser(user) });
  });
}
