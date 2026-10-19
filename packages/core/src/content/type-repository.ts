import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  ContentTypeValidationError,
  validateContentType,
  type ContentType,
  type ContentTypeInput,
} from "./model.ts";

export interface ContentTypeRepositoryOptions {
  tableName: string;
  client: DynamoDBDocumentClient;
}

export class ContentTypeRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(options: ContentTypeRepositoryOptions) {
    this.#client = options.client;
    this.#tableName = options.tableName;
  }

  async get(slug: string): Promise<ContentType | undefined> {
    const result = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { slug } }),
    );
    return result.Item as ContentType | undefined;
  }

  async list(): Promise<ContentType[]> {
    const result = await this.#client.send(new ScanCommand({ TableName: this.#tableName }));
    return (result.Items ?? []) as ContentType[];
  }

  async put(input: ContentTypeInput): Promise<ContentType> {
    const errors = validateContentType(input);
    if (errors.length > 0) {
      throw new ContentTypeValidationError(errors);
    }

    const existing = await this.get(input.slug);
    const now = new Date().toISOString();
    const contentType: ContentType = {
      slug: input.slug,
      name: input.name,
      fields: input.fields,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.#client.send(
      new PutCommand({
        TableName: this.#tableName,
        Item: contentType,
      }),
    );
    return contentType;
  }

  async delete(slug: string): Promise<boolean> {
    const result = await this.#client.send(
      new DeleteCommand({
        TableName: this.#tableName,
        Key: { slug },
        ReturnValues: "ALL_OLD",
      }),
    );
    return result.Attributes !== undefined;
  }
}

export function createContentTypeRepository(
  tableName: string,
  client?: DynamoDBDocumentClient,
): ContentTypeRepository {
  return new ContentTypeRepository({
    tableName,
    client: client ?? DynamoDBDocumentClient.from(new DynamoDBClient({})),
  });
}
