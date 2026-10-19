import {
  isValidEmailAddress,
  toPublicUser,
  UsernameTakenError,
  type NewUser,
  type UpdateUserInput,
} from "@provisionless/core";
import type { Hono } from "hono";

import { requireAdmin } from "../auth/middleware.ts";
import type { AppEnv, SessionDependencies } from "../auth/session.ts";
import type { UserManagementStore } from "./store.ts";

export interface UserRoutesDependencies extends SessionDependencies {
  users: UserManagementStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function registerUserRoutes(app: Hono<AppEnv>, deps: UserRoutesDependencies): void {
  app.get("/users", requireAdmin(deps), async (c) => {
    const users = await deps.users.listUsers();
    const publicUsers = users
      .map(toPublicUser)
      .sort((left, right) => left.username.localeCompare(right.username));
    return c.json({ users: publicUsers });
  });

  app.post("/users", requireAdmin(deps), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (!isRecord(body)) {
      return c.json({ error: "A JSON body is required" }, 400);
    }

    const username = readString(body.username)?.trim();
    const password = readString(body.password);
    const email = readString(body.email)?.trim();
    const firstName = readString(body.firstName)?.trim();
    const lastName = readString(body.lastName)?.trim();
    if (!username || !password || !email || !firstName || !lastName) {
      return c.json(
        { error: "username, password, email, firstName, and lastName are required" },
        400,
      );
    }
    if (!isValidEmailAddress(email)) {
      return c.json({ error: "Invalid email address" }, 400);
    }

    const isAdmin = body.isAdmin ?? false;
    const enabled = body.enabled ?? true;
    if (typeof isAdmin !== "boolean" || typeof enabled !== "boolean") {
      return c.json({ error: "isAdmin and enabled must be booleans" }, 400);
    }

    const input: NewUser = {
      username,
      password,
      email,
      firstName,
      lastName,
      isAdmin,
      enabled,
    };
    try {
      const user = await deps.users.createUser(input);
      return c.json({ user: toPublicUser(user) }, 201);
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        return c.json({ error: "Username is already taken" }, 409);
      }
      throw error;
    }
  });

  app.patch("/users/:username", requireAdmin(deps), async (c) => {
    const username = c.req.param("username").trim();
    const body = await c.req.json().catch(() => undefined);
    if (!username || !isRecord(body)) {
      return c.json({ error: "A JSON body is required" }, 400);
    }

    const changes: UpdateUserInput = {};
    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        return c.json({ error: "enabled must be a boolean" }, 400);
      }
      changes.enabled = body.enabled;
    }
    if ("isAdmin" in body) {
      if (typeof body.isAdmin !== "boolean") {
        return c.json({ error: "isAdmin must be a boolean" }, 400);
      }
      changes.isAdmin = body.isAdmin;
    }
    if ("email" in body) {
      const email = readString(body.email)?.trim();
      if (!email || !isValidEmailAddress(email)) {
        return c.json({ error: "Invalid email address" }, 400);
      }
      changes.email = email;
    }
    if ("firstName" in body) {
      const firstName = readString(body.firstName)?.trim();
      if (!firstName) {
        return c.json({ error: "firstName must not be empty" }, 400);
      }
      changes.firstName = firstName;
    }
    if ("lastName" in body) {
      const lastName = readString(body.lastName)?.trim();
      if (!lastName) {
        return c.json({ error: "lastName must not be empty" }, 400);
      }
      changes.lastName = lastName;
    }

    if (Object.keys(changes).length === 0) {
      return c.json({ error: "No supported fields to update" }, 400);
    }

    const existing = await deps.users.getUser(username);
    if (!existing) {
      return c.json({ error: "User not found" }, 404);
    }

    const user = await deps.users.updateUser(username, changes);
    return c.json({ user: toPublicUser(user) });
  });
}
