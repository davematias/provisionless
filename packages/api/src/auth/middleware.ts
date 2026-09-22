import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { verifySession, type SessionPayload } from "./jwt.ts";
import { SESSION_COOKIE, type AppEnv, type SessionDependencies } from "./session.ts";

function passwordMatches(session: SessionPayload, passwordChangedAt: string): boolean {
  return (session.passwordChangedAt ?? "") === passwordChangedAt;
}

export function requireAuth(deps: SessionDependencies): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await verifySession(token, deps.jwtSecret) : undefined;
    const user = session ? await deps.users.getUser(session.username) : undefined;
    if (!session || !user || !user.enabled || !passwordMatches(session, user.passwordChangedAt)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", user);
    await next();
  };
}
