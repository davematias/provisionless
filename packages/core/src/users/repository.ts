import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { NewUser, User } from "./model.ts";
import { isValidEmailAddress } from "./model.ts";
import { hashPassword } from "./password.ts";

/**
 * Raised when creating a user whose username already exists.
 */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken`);
    this.name = "UsernameTakenError";
  }
}

export interface UpdateUserInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  pictureUrl?: string;
  isAdmin?: boolean;
  enabled?: boolean;
  password?: string;
}

export interface UserRepositoryOptions {
  tableName: string;
  client: DynamoDBDocumentClient;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ConditionalCheckFailedException"
  );
}

/**
 * Stores users in DynamoDB keyed by username, hashing passwords before they are written.
 */
export class UserRepository {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  constructor(options: UserRepositoryOptions) {
    this.#client = options.client;
    this.#tableName = options.tableName;
  }

  /**
   * Creates a user with a hashed password.
   *
   * @throws {UsernameTakenError} When the username already exists.
   */
  async createUser(input: NewUser): Promise<User> {
    const now = new Date().toISOString();
    const email = input.email.trim();
    if (!isValidEmailAddress(email)) {
      throw new Error(`Invalid user email "${input.email}"`);
    }
    const user: User = {
      username: input.username,
      id: randomUUID(),
      passwordHash: await hashPassword(input.password),
      email,
      isAdmin: input.isAdmin,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
    };
    if (input.pictureUrl !== undefined) {
      user.pictureUrl = input.pictureUrl;
    }

    try {
      await this.#client.send(
        new PutCommand({
          TableName: this.#tableName,
          Item: user,
          ConditionExpression: "attribute_not_exists(username)",
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new UsernameTakenError(input.username);
      }
      throw error;
    }

    return user;
  }

  /**
   * Reads one user by username.
   */
  async getUser(username: string): Promise<User | undefined> {
    const result = await this.#client.send(
      new GetCommand({ TableName: this.#tableName, Key: { username } }),
    );
    return result.Item as User | undefined;
  }

  /**
   * Reads one user by id from the id index.
   */
  async getUserById(id: string): Promise<User | undefined> {
    const result = await this.#client.send(
      new QueryCommand({
        TableName: this.#tableName,
        IndexName: "id-index",
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: { ":id": id },
        Limit: 1,
      }),
    );
    return result.Items?.[0] as User | undefined;
  }

  /**
   * Lists every user.
   */
  async listUsers(): Promise<User[]> {
    const result = await this.#client.send(new ScanCommand({ TableName: this.#tableName }));
    return (result.Items ?? []) as User[];
  }

  /**
   * Applies the supplied fields, hashing a new password and bumping `passwordChangedAt` so existing
   * sessions stop working.
   *
   * Fails when the user does not exist.
   */
  async updateUser(username: string, changes: UpdateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const fields: Record<string, unknown> = { updatedAt: now };
    if (changes.email !== undefined) {
      const email = changes.email.trim();
      if (!isValidEmailAddress(email)) {
        throw new Error(`Invalid user email "${changes.email}"`);
      }
      fields.email = email;
    }
    if (changes.firstName !== undefined) fields.firstName = changes.firstName;
    if (changes.lastName !== undefined) fields.lastName = changes.lastName;
    if (changes.pictureUrl !== undefined) fields.pictureUrl = changes.pictureUrl;
    if (changes.isAdmin !== undefined) fields.isAdmin = changes.isAdmin;
    if (changes.enabled !== undefined) fields.enabled = changes.enabled;
    if (changes.password !== undefined) {
      fields.passwordHash = await hashPassword(changes.password);
      fields.passwordChangedAt = now;
    }

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const assignments: string[] = [];

    Object.entries(fields).forEach(([field, value], index) => {
      names[`#field${index}`] = field;
      values[`:value${index}`] = value;
      assignments.push(`#field${index} = :value${index}`);
    });

    const result = await this.#client.send(
      new UpdateCommand({
        TableName: this.#tableName,
        Key: { username },
        UpdateExpression: `SET ${assignments.join(", ")}`,
        ConditionExpression: "attribute_exists(username)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );

    return result.Attributes as User;
  }
}

/**
 * Creates a repository for the users table, using the default DynamoDB client when none is
 * supplied.
 */
export function createUserRepository(
  tableName: string,
  client?: DynamoDBDocumentClient,
): UserRepository {
  return new UserRepository({
    tableName,
    client: client ?? DynamoDBDocumentClient.from(new DynamoDBClient({})),
  });
}
