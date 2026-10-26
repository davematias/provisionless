import { toPublicUser, UsernameTakenError } from "@provisionless/core";
import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { requireAdmin } from "../auth/middleware.ts";
import type { AppEnv, SessionDependencies } from "../auth/session.ts";
import {
  errorResponse,
  jsonRequest,
  jsonResponse,
  pathParameter,
  SECURITY,
  validationErrorResponse,
} from "../openapi/helpers.ts";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  UserResponseSchema,
  UsersResponseSchema,
} from "./schemas.ts";
import { InvalidUserFieldError, UserNotFoundError, UserService } from "./service.ts";
import type { UserManagementStore } from "./store.ts";

export interface UserRoutesDependencies extends SessionDependencies {
  users: UserManagementStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mappedError(c: Context<AppEnv>, error: unknown): Response | undefined {
  if (error instanceof InvalidUserFieldError) {
    return c.json({ error: error.message }, 400);
  }
  if (error instanceof UserNotFoundError) {
    return c.json({ error: "User not found" }, 404);
  }
  return undefined;
}

export function registerUserRoutes(app: Hono<AppEnv>, deps: UserRoutesDependencies): void {
  const users = new UserService(deps.users);

  app.get(
    "/users",
    describeRoute({
      tags: ["Users"],
      summary: "List users",
      operationId: "listUsers",
      security: SECURITY,
      responses: {
        200: jsonResponse(UsersResponseSchema, "Users"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      const list = (await users.listUsers()).map(toPublicUser);
      return c.json({ users: list });
    },
  );

  app.post(
    "/users",
    describeRoute({
      tags: ["Users"],
      summary: "Create a user",
      operationId: "createUser",
      security: SECURITY,
      requestBody: jsonRequest(CreateUserRequestSchema),
      responses: {
        201: jsonResponse(UserResponseSchema, "User created"),
        400: validationErrorResponse("Invalid user"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
        409: errorResponse("Username is already taken"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      const body = await c.req.json().catch(() => undefined);
      if (!isRecord(body)) {
        return c.json({ error: "A JSON body is required" }, 400);
      }

      try {
        const user = await users.createUser(body);
        return c.json({ user: toPublicUser(user) }, 201);
      } catch (error) {
        if (error instanceof UsernameTakenError) {
          return c.json({ error: "Username is already taken" }, 409);
        }
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.patch(
    "/users/:username",
    describeRoute({
      tags: ["Users"],
      summary: "Update a user",
      operationId: "updateUser",
      security: SECURITY,
      parameters: [pathParameter("username")],
      requestBody: jsonRequest(UpdateUserRequestSchema),
      responses: {
        200: jsonResponse(UserResponseSchema, "User updated"),
        400: validationErrorResponse("Invalid user update"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
        404: errorResponse("User not found"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      const username = c.req.param("username").trim();
      const body = await c.req.json().catch(() => undefined);
      if (!username || !isRecord(body)) {
        return c.json({ error: "A JSON body is required" }, 400);
      }

      try {
        const user = await users.updateUser(username, body);
        return c.json({ user: toPublicUser(user) });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );
}
