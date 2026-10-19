import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { expect, it } from "vitest";

import { verifyPassword } from "./password.ts";
import { UserRepository, UsernameTakenError } from "./repository.ts";

function createRepository(send: (command: unknown) => Promise<unknown>): UserRepository {
  const client = { send } as unknown as DynamoDBDocumentClient;
  return new UserRepository({ tableName: "provisionless-users", client });
}

it("creates a user with a hashed password and timestamps", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  const user = await repository.createUser({
    username: "ada",
    password: "lovelace",
    email: "ada@example.com",
    isAdmin: true,
    firstName: "Ada",
    lastName: "Lovelace",
  });

  expect(user.email).toBe("ada@example.com");
  expect(user.id).toHaveLength(36);
  expect(user.passwordHash).not.toBe("lovelace");
  expect(await verifyPassword("lovelace", user.passwordHash)).toBe(true);
  expect(user.createdAt).toBe(user.updatedAt);
  expect(user.passwordChangedAt).toBe(user.createdAt);
  expect(user.enabled).toBe(true);

  const put = commands.find((command) => command instanceof PutCommand) as
    | { input: { ConditionExpression?: string; Item?: Record<string, unknown> } }
    | undefined;
  expect(put?.input.ConditionExpression).toBe("attribute_not_exists(username)");
  expect(put?.input.Item).not.toHaveProperty("password");
});

it("rejects a duplicate username", async () => {
  const repository = createRepository(async () => {
    const error = new Error("duplicate");
    error.name = "ConditionalCheckFailedException";
    throw error;
  });

  await expect(
    repository.createUser({
      username: "ada",
      password: "x",
      email: "ada@example.com",
      isAdmin: false,
      firstName: "Ada",
      lastName: "Lovelace",
    }),
  ).rejects.toBeInstanceOf(UsernameTakenError);
});

it("rejects an invalid email address on create", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  await expect(
    repository.createUser({
      username: "ada",
      password: "lovelace",
      email: "not-an-email",
      isAdmin: true,
      firstName: "Ada",
      lastName: "Lovelace",
    }),
  ).rejects.toThrow(/email/i);

  expect(commands).toHaveLength(0);
});

it("fetches a user by username", async () => {
  const repository = createRepository(async (command) => {
    if (command instanceof GetCommand) {
      return { Item: { username: "ada", id: "1" } };
    }
    return {};
  });

  const user = await repository.getUser("ada");

  expect(user?.id).toBe("1");
});

it("lists users", async () => {
  const repository = createRepository(async (command) => {
    if (command instanceof ScanCommand) {
      return { Items: [{ username: "ada" }, { username: "grace" }] };
    }
    return {};
  });

  const users = await repository.listUsers();

  expect(users.map((user) => user.username)).toEqual(["ada", "grace"]);
});

it("sets updatedAt when updating a user", async () => {
  const repository = createRepository(async (command) => {
    if (command instanceof UpdateCommand) {
      const values = command.input.ExpressionAttributeValues ?? {};
      return { Attributes: { username: "ada", updatedAt: values[":value0"] } };
    }
    return {};
  });

  const user = await repository.updateUser("ada", { firstName: "Ada" });

  expect(user.updatedAt).toBeDefined();
});

it("sets email when updating a user", async () => {
  const updates: UpdateCommand[] = [];
  const repository = createRepository(async (command) => {
    if (command instanceof UpdateCommand) {
      updates.push(command);
      return { Attributes: { username: "ada" } };
    }
    return {};
  });

  await repository.updateUser("ada", { email: "ada@example.com" });

  const fields = Object.values(updates[0]?.input.ExpressionAttributeNames ?? {});
  expect(fields).toContain("email");
});

it("rejects an invalid email address on update", async () => {
  const updates: UpdateCommand[] = [];
  const repository = createRepository(async (command) => {
    if (command instanceof UpdateCommand) {
      updates.push(command);
      return { Attributes: { username: "ada" } };
    }
    return {};
  });

  await expect(repository.updateUser("ada", { email: "not-an-email" })).rejects.toThrow(/email/i);
  expect(updates).toHaveLength(0);
});

it("bumps passwordChangedAt when the password changes", async () => {
  const updates: UpdateCommand[] = [];
  const repository = createRepository(async (command) => {
    if (command instanceof UpdateCommand) {
      updates.push(command);
      return { Attributes: { username: "ada" } };
    }
    return {};
  });

  await repository.updateUser("ada", { password: "new-secret" });

  const fields = Object.values(updates[0]?.input.ExpressionAttributeNames ?? {});
  expect(fields).toContain("passwordHash");
  expect(fields).toContain("passwordChangedAt");
});

it("does not touch passwordChangedAt for profile-only updates", async () => {
  const updates: UpdateCommand[] = [];
  const repository = createRepository(async (command) => {
    if (command instanceof UpdateCommand) {
      updates.push(command);
      return { Attributes: { username: "ada" } };
    }
    return {};
  });

  await repository.updateUser("ada", { firstName: "Augusta" });

  const fields = Object.values(updates[0]?.input.ExpressionAttributeNames ?? {});
  expect(fields).not.toContain("passwordHash");
  expect(fields).not.toContain("passwordChangedAt");
});
