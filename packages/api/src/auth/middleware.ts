import type { User } from "@provisionless/core";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { verifySession, type SessionPayload } from "./jwt.ts";
import { SESSION_COOKIE, type AppEnv, type SessionDependencies } from "./session.ts";

function passwordMatches(session: SessionPayload, passwordChangedAt: string): boolean {
  return (session.passwordChangedAt ?? "") === passwordChangedAt;
}

async function authenticate(
  c: Context<AppEnv>,
  deps: SessionDependencies,
): Promise<User | undefined> {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await verifySession(token, deps.jwtSecret) : undefined;
  const user = session ? await deps.users.getUser(session.username) : undefined;
  if (!session || !user || !user.enabled || !passwordMatches(session, user.passwordChangedAt)) {
    return undefined;
  }
  return user;
}

/**
 * Middleware that verifies the session cookie, rejects invalid or disabled sessions with `401`, and
 * exposes the user on the context.
 */
export function requireAuth(deps: SessionDependencies): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await authenticate(c, deps);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", user);
    await next();
  };
}

/**
 * Like `requireAuth`, and additionally rejects non-admin users with `403`.
 */
export function requireAdmin(deps: SessionDependencies): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await authenticate(c, deps);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!user.isAdmin) {
      return c.json({ error: "Forbidden" }, 403);
    }

    c.set("user", user);
    await next();
  };
}
