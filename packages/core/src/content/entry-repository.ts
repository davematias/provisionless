import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  ContentEntryValidationError,
  validateContentEntryValues,
  type ContentEntry,
  type ContentEntryValues,
  type ContentType,
} from "./model.ts";

export interface ContentEntryRepositoryOptions {
  tableName: string;
  client: DynamoDBDocumentClient;
}

export class ContentEntryNotFoundError extends Error {
  constructor(type: string, id: string) {
    super(`Content entry "${id}" of type "${type}" was not found`);
    this.name = "ContentEntryNotFoundError";
  }
}

export class ContentEntryRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(options: ContentEntryRepositoryOptions) {
    this.#client = options.client;
    this.#tableName = options.tableName;
  }

  async get(type: string, id: string): Promise<ContentEntry | undefined> {
    const result = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { type, id } }),
    );
    return result.Item as ContentEntry | undefined;
  }

  async list(type: string): Promise<ContentEntry[]> {
    const result = await this.#client.send(
      new QueryCommand({
        TableName: this.#tableName,
        KeyConditionExpression: "#type = :type",
        ExpressionAttributeNames: { "#type": "type" },
        ExpressionAttributeValues: { ":type": type },
      }),
    );
    return (result.Items ?? []) as ContentEntry[];
  }

  async create(contentType: ContentType, values: unknown): Promise<ContentEntry> {
    const errors = validateContentEntryValues(contentType, values);
    if (errors.length > 0) {
      throw new ContentEntryValidationError(errors);
    }

    const now = new Date().toISOString();
    const entry: ContentEntry = {
      type: contentType.slug,
      id: randomUUID(),
      values: values as ContentEntryValues,
      createdAt: now,
      updatedAt: now,
    };

    await this.#client.send(new PutCommand({ TableName: this.#tableName, Item: entry }));
    return entry;
  }

  async update(contentType: ContentType, id: string, values: unknown): Promise<ContentEntry> {
    const errors = validateContentEntryValues(contentType, values);
    if (errors.length > 0) {
      throw new ContentEntryValidationError(errors);
    }

    const existing = await this.get(contentType.slug, id);
    if (!existing) {
      throw new ContentEntryNotFoundError(contentType.slug, id);
    }

    const entry: ContentEntry = {
      ...existing,
      values: values as ContentEntryValues,
      updatedAt: new Date().toISOString(),
    };

    await this.#client.send(new PutCommand({ TableName: this.#tableName, Item: entry }));
    return entry;
  }

  async delete(type: string, id: string): Promise<boolean> {
    const result = await this.#client.send(
      new DeleteCommand({
        TableName: this.#tableName,
        Key: { type, id },
        ReturnValues: "ALL_OLD",
      }),
    );
    return result.Attributes !== undefined;
  }

  async deleteByType(type: string): Promise<number> {
    const entries = await this.list(type);
    let deleted = 0;
    for (const entry of entries) {
      if (await this.delete(entry.type, entry.id)) {
        deleted += 1;
      }
    }
    return deleted;
  }
}

export function createContentEntryRepository(
  tableName: string,
  client?: DynamoDBDocumentClient,
): ContentEntryRepository {
  return new ContentEntryRepository({
    tableName,
    client: client ?? DynamoDBDocumentClient.from(new DynamoDBClient({})),
  });
}
