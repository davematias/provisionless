import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { UserRepository } from "@provisionless/core";

import type { Logger } from "../util/log.ts";
import type { Ask } from "../util/prompt.ts";

export interface TestUserCredentials {
  username: string;
  password: string;
}

export interface SeedTestUserOptions {
  tableName: string;
  region: string;
  ask: Ask;
  log: Logger;
  client?: DynamoDBDocumentClient;
  username?: string;
  password?: string;
}

export async function seedTestUser(options: SeedTestUserOptions): Promise<TestUserCredentials> {
  const username = options.username ?? (await options.ask("Test user username: ")).trim();
  const password = options.password ?? (await options.ask("Test user password: ")).trim();
  if (!username || !password) {
    throw new Error("A username and password are required to seed the test user");
  }

  const client =
    options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: options.region }));
  const repository = new UserRepository({ tableName: options.tableName, client });

  const existing = await repository.getUser(username);
  if (existing) {
    await repository.updateUser(username, { password, enabled: true, isAdmin: true });
    options.log(`updated test user "${username}"`);
  } else {
    await repository.createUser({
      username,
      password,
      isAdmin: true,
      firstName: "Test",
      lastName: "User",
      enabled: true,
    });
    options.log(`created test user "${username}"`);
  }

  return { username, password };
}
