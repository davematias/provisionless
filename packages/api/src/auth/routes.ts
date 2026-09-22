import { toPublicUser, verifyPassword } from "@provisionless/core";
import type { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import { signSession } from "./jwt.ts";
import { requireAuth } from "./middleware.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AppEnv,
  type SessionDependencies,
} from "./session.ts";

export { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.ts";

export interface AuthDependencies extends SessionDependencies {
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

export function registerAuthRoutes(app: Hono<AppEnv>, deps: AuthDependencies): void {
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

    const token = await signSession(
      { username: user.username, passwordChangedAt: user.passwordChangedAt },
      deps.jwtSecret,
      SESSION_TTL_SECONDS,
    );
    setCookie(c, SESSION_COOKIE, token, cookieOptions(secure));
    return c.json({ user: toPublicUser(user) });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/auth/me", requireAuth(deps), async (c) => {
    const user = c.get("user");
    const refreshed = await signSession(
      { username: user.username, passwordChangedAt: user.passwordChangedAt },
      deps.jwtSecret,
      SESSION_TTL_SECONDS,
    );
    setCookie(c, SESSION_COOKIE, refreshed, cookieOptions(secure));
    return c.json({ user: toPublicUser(user) });
  });
}
