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

/**
 * Raised when no entry exists for a content type and id.
 */
export class ContentEntryNotFoundError extends Error {
  constructor(type: string, id: string) {
    super(`Content entry "${id}" of type "${type}" was not found`);
    this.name = "ContentEntryNotFoundError";
  }
}

/**
 * Stores content entries in DynamoDB keyed by content type and id, validating values before every
 * write.
 */
export class ContentEntryRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(options: ContentEntryRepositoryOptions) {
    this.#client = options.client;
    this.#tableName = options.tableName;
  }

  /**
   * Reads one entry, or `undefined` when it does not exist.
   */
  async get(type: string, id: string): Promise<ContentEntry | undefined> {
    const result = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { type, id } }),
    );
    return result.Item as ContentEntry | undefined;
  }

  /**
   * Lists every entry belonging to one content type.
   */
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

  /**
   * Validates the values and writes a new entry with a generated UUID.
   *
   * @throws {ContentEntryValidationError} When the values do not match the schema.
   */
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

  /**
   * Validates new values and replaces those of an existing entry.
   *
   * @throws {ContentEntryValidationError} When the values do not match the schema.
   * @throws {ContentEntryNotFoundError} When the entry does not exist.
   */
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

  /**
   * Deletes one entry, returning `false` when it was already gone.
   */
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

  /**
   * Deletes every entry of a content type and returns how many were removed.
   */
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

/**
 * Creates a repository for the entries table, using the default DynamoDB client when none is
 * supplied.
 */
export function createContentEntryRepository(
  tableName: string,
  client?: DynamoDBDocumentClient,
): ContentEntryRepository {
  return new ContentEntryRepository({
    tableName,
    client: client ?? DynamoDBDocumentClient.from(new DynamoDBClient({})),
  });
}
