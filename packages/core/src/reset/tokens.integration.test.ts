import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import dynalite, { type DynaliteServer } from "dynalite";
import { afterAll, beforeAll, expect, it } from "vitest";

import { ResetTokenRepository } from "./tokens.ts";

const TABLE_NAME = "provisionless-reset-tokens-integration";

let server: DynaliteServer;
let rawClient: DynamoDBClient;
let repository: ResetTokenRepository;

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
      AttributeDefinitions: [{ AttributeName: "tokenHash", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "tokenHash", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  repository = new ResetTokenRepository({
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

it("creates a single-use token and returns its username once", async () => {
  const token = await repository.create("ada");

  expect(await repository.consume(token)).toBe("ada");
  expect(await repository.consume(token)).toBeUndefined();
});

it("rejects a token that was never issued", async () => {
  expect(await repository.consume("never-issued")).toBeUndefined();
});

it("rejects an expired token", async () => {
  const expired = new ResetTokenRepository({
    tableName: TABLE_NAME,
    client: DynamoDBDocumentClient.from(rawClient),
    ttlSeconds: -1,
  });

  const token = await expired.create("grace");
  expect(await repository.consume(token)).toBeUndefined();
});

it("allows independent tokens for different users", async () => {
  const ada = await repository.create("ada");
  const grace = await repository.create("grace");

  expect(await repository.consume(grace)).toBe("grace");
  expect(await repository.consume(ada)).toBe("ada");
});
