import {
  hashPassword,
  UsernameTakenError,
  type NewUser,
  type UpdateUserInput,
  type User,
} from "@provisionless/core";
import { beforeEach, expect, it } from "vitest";

import { InvalidUserFieldError, UserNotFoundError, UserService } from "./service.ts";
import type { UserManagementStore } from "./store.ts";

class MemoryUserStore implements UserManagementStore {
  readonly users = new Map<string, User>();
  readonly updates: UpdateUserInput[] = [];

  async getUser(username: string): Promise<User | undefined> {
    return this.users.get(username);
  }

  async createUser(input: NewUser): Promise<User> {
    if (this.users.has(input.username)) {
      throw new UsernameTakenError(input.username);
    }
    const now = "2026-01-01T00:00:00.000Z";
    const user: User = {
      username: input.username,
      id: crypto.randomUUID(),
      passwordHash: await hashPassword(input.password),
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      isAdmin: input.isAdmin,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    };
    this.users.set(user.username, user);
    return user;
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()];
  }

  async updateUser(username: string, changes: UpdateUserInput): Promise<User> {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`Unknown user ${username}`);
    }
    this.updates.push(changes);
    Object.assign(user, changes);
    return user;
  }
}

let store: MemoryUserStore;
let service: UserService;

beforeEach(async () => {
  store = new MemoryUserStore();
  service = new UserService(store);
  await store.createUser({
    username: "grace",
    password: "hopper",
    email: "grace@example.com",
    firstName: "Grace",
    lastName: "Hopper",
    isAdmin: false,
    enabled: true,
  });
  await store.createUser({
    username: "ada",
    password: "lovelace",
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    isAdmin: true,
    enabled: true,
  });
});

it("lists users sorted by username", async () => {
  const users = await service.listUsers();

  expect(users.map((user) => user.username)).toEqual(["ada", "grace"]);
});

it("creates a user from request fields with trimmed values and defaults", async () => {
  const user = await service.createUser({
    username: "  linus  ",
    password: "tux",
    email: " linus@example.com ",
    firstName: " Linus ",
    lastName: " Torvalds ",
  });

  expect(user.username).toBe("linus");
  expect(user.email).toBe("linus@example.com");
  expect(user.isAdmin).toBe(false);
  expect(user.enabled).toBe(true);
});

it("rejects incomplete or malformed user fields", async () => {
  await expect(service.createUser({ username: "linus" })).rejects.toThrow(InvalidUserFieldError);
  await expect(
    service.createUser({
      username: "linus",
      password: "tux",
      email: "not-an-email",
      firstName: "Linus",
      lastName: "Torvalds",
      isAdmin: "yes",
    }),
  ).rejects.toThrow("Invalid email address");
  await expect(
    service.createUser({
      username: "linus",
      password: "tux",
      email: "linus@example.com",
      firstName: "Linus",
      lastName: "Torvalds",
      enabled: "yes",
    }),
  ).rejects.toThrow("isAdmin and enabled must be booleans");
});

it("lets the store reject duplicate usernames", async () => {
  await expect(
    service.createUser({
      username: "ada",
      password: "tux",
      email: "linus@example.com",
      firstName: "Linus",
      lastName: "Torvalds",
    }),
  ).rejects.toThrow(UsernameTakenError);
});

it("applies only the supported update fields", async () => {
  const user = await service.updateUser("grace", {
    enabled: false,
    isAdmin: true,
    email: " grace.hopper@example.com ",
    firstName: " Grace ",
    lastName: " Murray Hopper ",
  });

  expect(user.enabled).toBe(false);
  expect(user.isAdmin).toBe(true);
  expect(user.email).toBe("grace.hopper@example.com");
  expect(user.lastName).toBe("Murray Hopper");
  expect(store.updates).toHaveLength(1);
});

it("validates update fields before looking up the user", async () => {
  await expect(service.updateUser("nobody", { enabled: "no" })).rejects.toThrow(
    "enabled must be a boolean",
  );
  await expect(service.updateUser("nobody", {})).rejects.toThrow("No supported fields to update");
  await expect(service.updateUser("nobody", { email: "nope" })).rejects.toThrow(
    "Invalid email address",
  );
  await expect(service.updateUser("nobody", { firstName: "  " })).rejects.toThrow(
    "firstName must not be empty",
  );
});

it("reports unknown users after validation passes", async () => {
  await expect(service.updateUser("nobody", { enabled: false })).rejects.toThrow(UserNotFoundError);
});
