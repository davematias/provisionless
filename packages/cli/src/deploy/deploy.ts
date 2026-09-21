import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { createAwsClients } from "../aws/clients.ts";
import { apiNames } from "../aws/names.ts";
import { resolveAppPrefix } from "../config/config.ts";
import { createLogger } from "../util/log.ts";
import { createPrompter } from "../util/prompt.ts";
import { findRepoRoot } from "../util/repo.ts";
import { deployAdmin } from "./admin.ts";
import { deployApi } from "./api.ts";
import type { DeployContext, DeployOptions } from "./context.ts";
import { seedTestUser, type TestUserCredentials } from "./seed.ts";

export interface DeployResult {
  apiUrl: string;
  adminUrl: string;
  testUser?: TestUserCredentials;
}

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const repoRoot = findRepoRoot(process.cwd());
  const clients = createAwsClients(options.region);
  const log = createLogger();
  const prompter = createPrompter();

  try {
    const appPrefix = await resolveAppPrefix({
      repoRoot,
      prefix: options.prefix,
      ask: prompter.ask,
      log,
      persist: !options.dryRun,
    });

    let accountId = "000000000000";
    if (!options.dryRun) {
      const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
      if (!identity.Account) {
        throw new Error("Could not determine the AWS account ID. Check your credentials.");
      }
      accountId = identity.Account;
    }

    const ctx: DeployContext = {
      region: options.region,
      accountId,
      dryRun: options.dryRun,
      repoRoot,
      appPrefix,
      log,
      clients,
    };

    log(
      options.dryRun
        ? `dry run for app "${appPrefix}": no AWS resources will be changed`
        : `deploying app "${appPrefix}" to account ${accountId} in ${options.region}`,
    );

    const apiUrl = await deployApi(ctx);
    const admin = await deployAdmin(ctx);

    log(`API URL:   ${apiUrl}`);
    log(`Admin URL: ${admin.url}`);

    let testUser: TestUserCredentials | undefined;
    if (!options.dryRun) {
      testUser = await seedTestUser({
        tableName: apiNames(appPrefix).usersTable,
        region: options.region,
        ask: prompter.ask,
        log,
        username: options.testUserUsername,
        password: options.testUserPassword,
      });
      log(`test user login: ${testUser.username} / ${testUser.password}`);
    }

    return { apiUrl, adminUrl: admin.url, testUser };
  } finally {
    prompter.close();
  }
}
