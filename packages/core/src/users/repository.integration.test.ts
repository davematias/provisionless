import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dynalite, { type DynaliteServer } from "dynalite";
import { afterAll, beforeAll, expect, it } from "vitest";

import { verifyPassword } from "./password.ts";
import { UserRepository, UsernameTakenError } from "./repository.ts";

const TABLE_NAME = "provisionless-users-integration";

let server: DynaliteServer;
let rawClient: DynamoDBClient;
let repository: UserRepository;

beforeAll(async () => {
  server = dynalite({ createTableMs: 0, updateTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine the dynalite port");
  }

  rawClient = new DynamoDBClient({
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${address.port}`,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

  await rawClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      AttributeDefinitions: [
        { AttributeName: "username", AttributeType: "S" },
        { AttributeName: "id", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "username", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "id-index",
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  repository = new UserRepository({
    tableName: TABLE_NAME,
    client: DynamoDBDocumentClient.from(rawClient),
  });
});

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

it("creates a user and stores only a password hash", async () => {
  const user = await repository.createUser({
    username: "ada",
    password: "lovelace",
    email: "ada@example.com",
    isAdmin: true,
    firstName: "Ada",
    lastName: "Lovelace",
  });

  expect(user.username).toBe("ada");
  expect(user.email).toBe("ada@example.com");
  expect(await verifyPassword("lovelace", user.passwordHash)).toBe(true);

  const stored = await repository.getUser("ada");
  expect(stored?.passwordHash).not.toBe("lovelace");
  expect(stored?.isAdmin).toBe(true);
});

it("rejects a duplicate username", async () => {
  await expect(
    repository.createUser({
      username: "ada",
      password: "again",
      email: "ada@example.com",
      isAdmin: false,
      firstName: "Ada",
      lastName: "Lovelace",
    }),
  ).rejects.toBeInstanceOf(UsernameTakenError);
});

it("fetches a user by id through the secondary index", async () => {
  const created = await repository.createUser({
    username: "grace",
    password: "hopper",
    email: "grace@example.com",
    isAdmin: false,
    firstName: "Grace",
    lastName: "Hopper",
  });

  const byId = await repository.getUserById(created.id);
  expect(byId?.username).toBe("grace");
});

it("lists users", async () => {
  const users = await repository.listUsers();
  expect(users.map((user) => user.username).sort()).toEqual(["ada", "grace"]);
});

it("updates a user and bumps updatedAt", async () => {
  const before = await repository.getUser("ada");

  const updated = await repository.updateUser("ada", { firstName: "Augusta", enabled: false });

  expect(updated.firstName).toBe("Augusta");
  expect(updated.enabled).toBe(false);
  expect((updated.updatedAt ?? "") >= (before?.updatedAt ?? "")).toBe(true);
});

it("changes passwordChangedAt only when the password changes", async () => {
  const before = await repository.getUser("ada");

  const profileUpdate = await repository.updateUser("ada", { firstName: "Ada" });
  expect(profileUpdate.passwordChangedAt).toBe(before?.passwordChangedAt);

  const passwordUpdate = await repository.updateUser("ada", { password: "new-lovelace" });
  expect((passwordUpdate.passwordChangedAt ?? "") > (before?.passwordChangedAt ?? "")).toBe(true);
  expect(await verifyPassword("new-lovelace", passwordUpdate.passwordHash)).toBe(true);
});
