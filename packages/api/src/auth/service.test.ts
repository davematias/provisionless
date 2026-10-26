import { hashPassword, type NewUser, type UpdateUserInput, type User } from "@provisionless/core";
import { beforeEach, expect, it, vi } from "vitest";

import { UserNotFoundError } from "../users/service.ts";
import type { UserManagementStore } from "../users/store.ts";
import { verifySession } from "./jwt.ts";
import { AuthService, type ResetTokenStore } from "./service.ts";

const JWT_SECRET = "test-secret";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    username: "ada",
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    isAdmin: true,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    passwordChangedAt: "2026-01-01T00:00:00.000Z",
    passwordHash: "",
    ...overrides,
  };
}

let user: User;
let store: UserManagementStore;
let resetTokens: ResetTokenStore;
let service: AuthService;

beforeEach(async () => {
  user = makeUser({ passwordHash: await hashPassword("lovelace") });

  store = {
    getUser: async (username) => (username === user.username ? user : undefined),
    createUser: async (_input: NewUser) => {
      throw new Error("not used");
    },
    listUsers: async () => [user],
    updateUser: vi.fn(async (username: string, changes: UpdateUserInput) => {
      if (username !== user.username) {
        throw new Error(`Unknown user ${username}`);
      }
      user = { ...user, ...changes, updatedAt: "2026-02-01T00:00:00.000Z" };
      return user;
    }),
  };

  resetTokens = {
    create: vi.fn(async () => "reset-token"),
    consume: vi.fn(async (token) => (token === "reset-token" ? user.username : undefined)),
  };

  service = new AuthService({
    users: store,
    resetTokens,
    jwtSecret: JWT_SECRET,
  });
});

it("returns the user and a session token for valid credentials", async () => {
  const result = await service.login("ada", "lovelace");

  expect(result?.user.username).toBe("ada");
  const session = await verifySession(result?.token ?? "", JWT_SECRET);
  expect(session?.username).toBe("ada");
  expect(session?.passwordChangedAt).toBe(user.passwordChangedAt);
});

it("rejects wrong passwords, unknown users, and disabled users", async () => {
  expect(await service.login("ada", "wrong")).toBeUndefined();
  expect(await service.login("nobody", "lovelace")).toBeUndefined();

  user = { ...user, enabled: false };
  expect(await service.login("ada", "lovelace")).toBeUndefined();
});

it("signs a session token for an already authenticated user", async () => {
  const token = await service.createSessionToken(user);

  const session = await verifySession(token, JWT_SECRET);
  expect(session?.username).toBe("ada");
});

it("delivers a reset token only for known users", async () => {
  const deliverReset = vi.fn();
  service = new AuthService({
    users: store,
    resetTokens,
    jwtSecret: JWT_SECRET,
    deliverReset,
  });

  await service.requestPasswordReset("ada");
  expect(resetTokens.create).toHaveBeenCalledWith("ada");
  expect(deliverReset).toHaveBeenCalledWith(user, "reset-token");

  await service.requestPasswordReset("nobody");
  expect(deliverReset).toHaveBeenCalledTimes(1);
});

it("builds reset links from the configured admin URL", async () => {
  expect(await service.createResetLink("ada")).toEqual({
    username: "ada",
    url: "http://localhost:3001/reset?token=reset-token",
  });

  service = new AuthService({
    users: store,
    resetTokens,
    jwtSecret: JWT_SECRET,
    adminBaseUrl: "https://admin.example.com/",
  });
  expect(await service.createResetLink("ada")).toEqual({
    username: "ada",
    url: "https://admin.example.com/reset?token=reset-token",
  });
});

it("reports unknown users when creating a reset link", async () => {
  await expect(service.createResetLink("nobody")).rejects.toThrow(UserNotFoundError);
});

it("confirms a reset token by setting the new password", async () => {
  expect(await service.confirmPasswordReset("reset-token", "new-password")).toBe(true);
  expect(store.updateUser).toHaveBeenCalledWith("ada", { password: "new-password" });
});

it("rejects unknown or expired reset tokens", async () => {
  expect(await service.confirmPasswordReset("expired", "new-password")).toBe(false);
});
