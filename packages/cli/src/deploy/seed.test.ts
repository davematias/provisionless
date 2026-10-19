import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { expect, it } from "vitest";

import { seedTestUser } from "./seed.ts";

function mockClient(send: (command: unknown) => Promise<unknown>): DynamoDBDocumentClient {
  return { send } as unknown as DynamoDBDocumentClient;
}

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

const answersFor =
  (username: string, password: string, email: string) => async (question: string) => {
    if (question.includes("username")) return username;
    if (question.includes("email")) return email;
    return password;
  };

it("creates the test user when it does not exist", async () => {
  const commands: unknown[] = [];

  const credentials = await seedTestUser({
    tableName: "demo-users",
    region: "us-east-1",
    ask: answersFor("admin", "s3cret", "admin@example.com"),
    log: () => undefined,
    client: mockClient(async (command) => {
      commands.push(command);
      return {};
    }),
  });

  expect(credentials).toEqual({
    username: "admin",
    password: "s3cret",
    email: "admin@example.com",
  });
  expect(commands.map(commandName)).toContain("PutCommand");
  expect(commands.map(commandName)).not.toContain("UpdateCommand");

  const put = commands.find((command) => commandName(command) === "PutCommand") as
    | { input: { Item?: Record<string, unknown> } }
    | undefined;
  expect(put?.input.Item?.email).toBe("admin@example.com");
});

it("resets the password and email when the test user already exists", async () => {
  const commands: unknown[] = [];

  const credentials = await seedTestUser({
    tableName: "demo-users",
    region: "us-east-1",
    ask: answersFor("admin", "newpass", "new@example.com"),
    log: () => undefined,
    client: mockClient(async (command) => {
      commands.push(command);
      if (commandName(command) === "GetCommand") {
        return { Item: { username: "admin" } };
      }
      return {};
    }),
  });

  expect(credentials.password).toBe("newpass");
  expect(credentials.email).toBe("new@example.com");
  expect(commands.map(commandName)).not.toContain("PutCommand");
  expect(commands.map(commandName)).toContain("UpdateCommand");
});

it("uses provided credentials without prompting", async () => {
  let promptCount = 0;

  const credentials = await seedTestUser({
    tableName: "demo-users",
    region: "us-east-1",
    ask: async () => {
      promptCount += 1;
      return "";
    },
    log: () => undefined,
    client: mockClient(async () => ({})),
    username: "admin",
    password: "s3cret",
    email: "admin@example.com",
  });

  expect(credentials).toEqual({
    username: "admin",
    password: "s3cret",
    email: "admin@example.com",
  });
  expect(promptCount).toBe(0);
});

it("prompts for an email when only the username and password are provided", async () => {
  const credentials = await seedTestUser({
    tableName: "demo-users",
    region: "us-east-1",
    ask: async () => "admin@example.com",
    log: () => undefined,
    client: mockClient(async () => ({})),
    username: "admin",
    password: "s3cret",
  });

  expect(credentials.email).toBe("admin@example.com");
});

it("requires a username, password, and valid email", async () => {
  await expect(
    seedTestUser({
      tableName: "demo-users",
      region: "us-east-1",
      ask: async () => "",
      log: () => undefined,
      client: mockClient(async () => ({})),
    }),
  ).rejects.toThrow();

  await expect(
    seedTestUser({
      tableName: "demo-users",
      region: "us-east-1",
      ask: async () => "",
      log: () => undefined,
      client: mockClient(async () => ({})),
      username: "admin",
      password: "s3cret",
      email: "not-an-email",
    }),
  ).rejects.toThrow();
});
