import { toPublicUser, verifyPassword, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import type { UserManagementStore } from "../users/store.ts";
import { signSession } from "./jwt.ts";
import { requireAdmin, requireAuth } from "./middleware.ts";
import { buildResetUrl, DEFAULT_ADMIN_BASE_URL } from "./reset-link.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AppEnv,
  type SessionDependencies,
} from "./session.ts";

export { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.ts";

export interface ResetTokenStore {
  create(username: string): Promise<string>;
  consume(token: string): Promise<string | undefined>;
}

export interface AuthDependencies extends SessionDependencies {
  users: UserManagementStore;
  resetTokens: ResetTokenStore;
  deliverReset?: (user: User, token: string) => void | Promise<void>;
  adminBaseUrl?: string;
  secureCookies?: boolean;
  cookieSameSite?: "Lax" | "None";
}

function cookieOptions(secure: boolean, sameSite: "Lax" | "None") {
  return {
    httpOnly: true,
    secure: sameSite === "None" ? true : secure,
    sameSite,
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

function extractUsername(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { username } = body as { username?: unknown };
  if (typeof username !== "string" || username.trim() === "") {
    return undefined;
  }
  return username.trim();
}

function extractResetConfirmation(body: unknown): { token: string; password: string } | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { token, password } = body as { token?: unknown; password?: unknown };
  if (
    typeof token !== "string" ||
    token.trim() === "" ||
    typeof password !== "string" ||
    password === ""
  ) {
    return undefined;
  }
  return { token: token.trim(), password };
}

export function registerAuthRoutes(app: Hono<AppEnv>, deps: AuthDependencies): void {
  const secure = deps.secureCookies ?? true;
  const cookies = cookieOptions(secure, deps.cookieSameSite ?? "Lax");

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
    setCookie(c, SESSION_COOKIE, token, cookies);
    return c.json({ user: toPublicUser(user) });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/auth/reset/request", async (c) => {
    const username = extractUsername(await c.req.json().catch(() => undefined));
    if (!username) {
      return c.json({ error: "username is required" }, 400);
    }

    const user = await deps.users.getUser(username);
    if (user) {
      const token = await deps.resetTokens.create(user.username);
      await deps.deliverReset?.(user, token);
    }
    return c.json({ ok: true });
  });

  app.post("/auth/reset/link", requireAdmin(deps), async (c) => {
    const username = extractUsername(await c.req.json().catch(() => undefined));
    if (!username) {
      return c.json({ error: "username is required" }, 400);
    }

    const target = await deps.users.getUser(username);
    if (!target) {
      return c.json({ error: "User not found" }, 404);
    }

    const token = await deps.resetTokens.create(target.username);
    return c.json({
      username: target.username,
      url: buildResetUrl(deps.adminBaseUrl ?? DEFAULT_ADMIN_BASE_URL, token),
    });
  });

  app.post("/auth/reset/confirm", async (c) => {
    const confirmation = extractResetConfirmation(await c.req.json().catch(() => undefined));
    if (!confirmation) {
      return c.json({ error: "token and password are required" }, 400);
    }

    const username = await deps.resetTokens.consume(confirmation.token);
    const user = username ? await deps.users.getUser(username) : undefined;
    if (!user) {
      return c.json({ error: "Invalid or expired reset token" }, 400);
    }

    await deps.users.updateUser(user.username, { password: confirmation.password });
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
    setCookie(c, SESSION_COOKIE, refreshed, cookies);
    return c.json({ user: toPublicUser(user) });
  });
}
