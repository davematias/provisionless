import { createHash, randomBytes } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const DEFAULT_TTL_SECONDS = 60 * 60;
const TOKEN_BYTES = 32;

export interface ResetTokenRepositoryOptions {
  tableName: string;
  client: DynamoDBDocumentClient;
  ttlSeconds?: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ConditionalCheckFailedException"
  );
}

export class ResetTokenRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;
  readonly #ttlSeconds: number;

  constructor(options: ResetTokenRepositoryOptions) {
    this.#client = options.client;
    this.#tableName = options.tableName;
    this.#ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  async create(username: string): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const createdAt = nowSeconds();
    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: {
          tokenHash: hashToken(token),
          username,
          createdAt: new Date(createdAt * 1000).toISOString(),
          expiresAt: createdAt + this.#ttlSeconds,
        },
      }),
    );
    return token;
  }

  async consume(token: string): Promise<string | undefined> {
    try {
      const result = await this.#client.send(
        new DeleteCommand({
          TableName: this.#tableName,
          Key: { tokenHash: hashToken(token) },
          ConditionExpression: "attribute_exists(tokenHash) AND expiresAt > :now",
          ExpressionAttributeValues: { ":now": nowSeconds() },
          ReturnValues: "ALL_OLD",
        }),
      );
      const username = result.Attributes?.username;
      return typeof username === "string" ? username : undefined;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

export function createResetTokenRepository(
  tableName: string,
  client?: DynamoDBDocumentClient,
): ResetTokenRepository {
  return new ResetTokenRepository({
    tableName,
    client: client ?? DynamoDBDocumentClient.from(new DynamoDBClient({})),
  });
}
