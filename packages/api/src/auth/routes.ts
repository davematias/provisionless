import { toPublicUser, type User } from "@provisionless/core";
import type { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";

import { OkResponseSchema } from "../openapi/common.ts";
import {
  errorResponse,
  jsonRequest,
  jsonResponse,
  SECURITY,
  validationErrorResponse,
} from "../openapi/helpers.ts";
import { UserResponseSchema } from "../users/schemas.ts";
import { UserNotFoundError } from "../users/service.ts";
import type { UserManagementStore } from "../users/store.ts";
import {
  LoginRequestSchema,
  ResetConfirmSchema,
  ResetLinkRequestSchema,
  ResetLinkResponseSchema,
  ResetRequestSchema,
} from "./schemas.ts";
import { requireAdmin, requireAuth } from "./middleware.ts";
import { AuthService, type ResetTokenStore } from "./service.ts";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AppEnv,
  type SessionDependencies,
} from "./session.ts";

export { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.ts";
export type { ResetTokenStore } from "./service.ts";

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
  const auth = new AuthService(deps);

  app.post(
    "/auth/login",
    describeRoute({
      tags: ["Auth"],
      summary: "Sign in and set the session cookie",
      operationId: "login",
      requestBody: jsonRequest(LoginRequestSchema),
      responses: {
        200: jsonResponse(UserResponseSchema, "Signed in"),
        400: validationErrorResponse("username and password are required"),
        401: errorResponse("Invalid username or password"),
      },
    }),
    async (c) => {
      const credentials = extractCredentials(await c.req.json().catch(() => undefined));
      if (!credentials) {
        return c.json({ error: "username and password are required" }, 400);
      }

      const result = await auth.login(credentials.username, credentials.password);
      if (!result) {
        return c.json({ error: "Invalid username or password" }, 401);
      }

      setCookie(c, SESSION_COOKIE, result.token, cookies);
      return c.json({ user: toPublicUser(result.user) });
    },
  );

  app.post(
    "/auth/logout",
    describeRoute({
      tags: ["Auth"],
      summary: "Clear the session cookie",
      operationId: "logout",
      responses: {
        200: jsonResponse(OkResponseSchema, "Signed out"),
      },
    }),
    (c) => {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true });
    },
  );

  app.post(
    "/auth/reset/request",
    describeRoute({
      tags: ["Auth"],
      summary: "Request a password reset email",
      operationId: "requestPasswordReset",
      requestBody: jsonRequest(ResetRequestSchema),
      responses: {
        200: jsonResponse(OkResponseSchema, "Request accepted"),
        400: validationErrorResponse("username is required"),
      },
    }),
    async (c) => {
      const username = extractUsername(await c.req.json().catch(() => undefined));
      if (!username) {
        return c.json({ error: "username is required" }, 400);
      }

      await auth.requestPasswordReset(username);
      return c.json({ ok: true });
    },
  );

  app.post(
    "/auth/reset/link",
    describeRoute({
      tags: ["Auth"],
      summary: "Create a shareable password reset link",
      operationId: "createPasswordResetLink",
      security: SECURITY,
      requestBody: jsonRequest(ResetLinkRequestSchema),
      responses: {
        200: jsonResponse(ResetLinkResponseSchema, "Reset link created"),
        400: validationErrorResponse("username is required"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
        404: errorResponse("User not found"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      const username = extractUsername(await c.req.json().catch(() => undefined));
      if (!username) {
        return c.json({ error: "username is required" }, 400);
      }

      try {
        return c.json(await auth.createResetLink(username));
      } catch (error) {
        if (error instanceof UserNotFoundError) {
          return c.json({ error: "User not found" }, 404);
        }
        throw error;
      }
    },
  );

  app.post(
    "/auth/reset/confirm",
    describeRoute({
      tags: ["Auth"],
      summary: "Set a new password with a reset token",
      operationId: "confirmPasswordReset",
      requestBody: jsonRequest(ResetConfirmSchema),
      responses: {
        200: jsonResponse(OkResponseSchema, "Password reset"),
        400: errorResponse("token and password are required"),
      },
    }),
    async (c) => {
      const confirmation = extractResetConfirmation(await c.req.json().catch(() => undefined));
      if (!confirmation) {
        return c.json({ error: "token and password are required" }, 400);
      }

      const confirmed = await auth.confirmPasswordReset(confirmation.token, confirmation.password);
      if (!confirmed) {
        return c.json({ error: "Invalid or expired reset token" }, 400);
      }

      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ ok: true });
    },
  );

  app.get(
    "/auth/me",
    describeRoute({
      tags: ["Auth"],
      summary: "Return the current user",
      operationId: "getCurrentUser",
      security: SECURITY,
      responses: {
        200: jsonResponse(UserResponseSchema, "Current user"),
        401: errorResponse("Unauthorized"),
      },
    }),
    requireAuth(deps),
    async (c) => {
      const user = c.get("user");
      const refreshed = await auth.createSessionToken(user);
      setCookie(c, SESSION_COOKIE, refreshed, cookies);
      return c.json({ user: toPublicUser(user) });
    },
  );
}
