import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { UserRepository, isValidEmailAddress } from "@provisionless/core";

import type { Logger } from "../util/log.ts";
import type { Ask } from "../util/prompt.ts";

export interface TestUserCredentials {
  username: string;
  password: string;
  email: string;
}

export interface SeedTestUserOptions {
  tableName: string;
  region: string;
  ask: Ask;
  log: Logger;
  client?: DynamoDBDocumentClient;
  username?: string;
  password?: string;
  email?: string;
}

export async function seedTestUser(options: SeedTestUserOptions): Promise<TestUserCredentials> {
  const username = options.username ?? (await options.ask("Test user username: ")).trim();
  const password = options.password ?? (await options.ask("Test user password: ")).trim();
  const email = (options.email ?? (await options.ask("Test user email: "))).trim();
  if (!username || !password) {
    throw new Error("A username and password are required to seed the test user");
  }
  if (!isValidEmailAddress(email)) {
    throw new Error(`Invalid test user email "${email}". Use an email address.`);
  }

  const client =
    options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: options.region }));
  const repository = new UserRepository({ tableName: options.tableName, client });

  const existing = await repository.getUser(username);
  if (existing) {
    await repository.updateUser(username, { password, email, enabled: true, isAdmin: true });
    options.log(`updated test user "${username}"`);
  } else {
    await repository.createUser({
      username,
      password,
      email,
      isAdmin: true,
      firstName: "Test",
      lastName: "User",
      enabled: true,
    });
    options.log(`created test user "${username}"`);
  }

  return { username, password, email };
}
