import { createHash } from "node:crypto";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { expect, it } from "vitest";

import { ResetTokenRepository } from "./tokens.ts";

function createRepository(
  send: (command: unknown) => Promise<unknown>,
  ttlSeconds?: number,
): ResetTokenRepository {
  const client = { send } as unknown as DynamoDBDocumentClient;
  return new ResetTokenRepository({
    tableName: "provisionless-reset-tokens",
    client,
    ttlSeconds,
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface PutInput {
  input: { Item?: Record<string, unknown> };
}

interface DeleteInput {
  input: {
    Key?: Record<string, unknown>;
    ConditionExpression?: string;
    ExpressionAttributeValues?: Record<string, unknown>;
    ReturnValues?: string;
  };
}

it("creates a token and stores only its hash with an expiry", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  });

  const token = await repository.create("ada");

  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const put = commands.find((command) => command instanceof PutCommand) as PutInput | undefined;
  expect(put?.input.Item?.tokenHash).toBe(hashToken(token));
  expect(put?.input.Item?.username).toBe("ada");
  expect(put?.input.Item).not.toHaveProperty("token");
});

it("expires tokens after the configured ttl", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return {};
  }, 120);

  const before = Math.floor(Date.now() / 1000);
  await repository.create("ada");

  const put = commands.find((command) => command instanceof PutCommand) as PutInput | undefined;
  const expiresAt = put?.input.Item?.expiresAt as number;
  expect(expiresAt).toBeGreaterThanOrEqual(before + 120);
  expect(expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 120);
});

it("consumes a token atomically and returns its username", async () => {
  const commands: unknown[] = [];
  const repository = createRepository(async (command) => {
    commands.push(command);
    return { Attributes: { username: "ada" } };
  });

  const username = await repository.consume("secret-token");

  expect(username).toBe("ada");
  const remove = commands.find((command) => command instanceof DeleteCommand) as
    | DeleteInput
    | undefined;
  expect(remove?.input.Key).toEqual({ tokenHash: hashToken("secret-token") });
  expect(remove?.input.ConditionExpression).toContain("expiresAt > :now");
  expect(remove?.input.ReturnValues).toBe("ALL_OLD");
});

it("returns undefined for a missing or expired token", async () => {
  const repository = createRepository(async () => {
    const error = new Error("gone");
    error.name = "ConditionalCheckFailedException";
    throw error;
  });

  await expect(repository.consume("gone")).resolves.toBeUndefined();
});

it("returns undefined when the stored item has no username", async () => {
  const repository = createRepository(async () => ({ Attributes: {} }));

  await expect(repository.consume("odd")).resolves.toBeUndefined();
});

it("propagates unexpected DynamoDB errors", async () => {
  const repository = createRepository(async () => {
    throw new Error("boom");
  });

  await expect(repository.consume("x")).rejects.toThrow("boom");
});
