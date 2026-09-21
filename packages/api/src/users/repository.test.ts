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
    isAdmin: true,
    firstName: "Ada",
    lastName: "Lovelace",
  });

  expect(user.id).toHaveLength(36);
  expect(user.passwordHash).not.toBe("lovelace");
  expect(await verifyPassword("lovelace", user.passwordHash)).toBe(true);
  expect(user.createdAt).toBe(user.updatedAt);
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
      isAdmin: false,
      firstName: "Ada",
      lastName: "Lovelace",
    }),
  ).rejects.toBeInstanceOf(UsernameTakenError);
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
