import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { expect, it } from "vitest";

import { seedTestUser } from "./seed.ts";

function mockClient(send: (command: unknown) => Promise<unknown>): DynamoDBDocumentClient {
  return { send } as unknown as DynamoDBDocumentClient;
}

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

const answersFor = (username: string, password: string) => async (question: string) =>
  question.includes("username") ? username : password;

it("creates the test user when it does not exist", async () => {
  const commands: unknown[] = [];

  const credentials = await seedTestUser({
    tableName: "demo-users",
    region: "us-east-1",
    ask: answersFor("admin", "s3cret"),
    log: () => undefined,
    client: mockClient(async (command) => {
      commands.push(command);
      return {};
    }),
  });

  expect(credentials).toEqual({ username: "admin", password: "s3cret" });
  expect(commands.map(commandName)).toContain("PutCommand");
  expect(commands.map(commandName)).not.toContain("UpdateCommand");
});

it("resets the password when the test user already exists", async () => {
  const commands: unknown[] = [];

  const credentials = await seedTestUser({
    tableName: "demo-users",
    region: "us-east-1",
    ask: answersFor("admin", "newpass"),
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
  });

  expect(credentials).toEqual({ username: "admin", password: "s3cret" });
  expect(promptCount).toBe(0);
});

it("requires both a username and a password", async () => {
  await expect(
    seedTestUser({
      tableName: "demo-users",
      region: "us-east-1",
      ask: async () => "",
      log: () => undefined,
      client: mockClient(async () => ({})),
    }),
  ).rejects.toThrow();
});
