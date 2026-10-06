import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { createAwsClients } from "../aws/clients.ts";
import { apiNames } from "../aws/names.ts";
import {
  resolveAppPrefix,
  resolveDomains,
  resolveJwtSecret,
  resolveRegion,
} from "../config/config.ts";
import { createLogger } from "../util/log.ts";
import { createPrompter } from "../util/prompt.ts";
import { findRepoRoot } from "../util/repo.ts";
import { deployAdmin } from "./admin.ts";
import { deployApi } from "./api.ts";
import { ensureCertificates } from "./certificates.ts";
import type { DeployContext, DeployOptions } from "./context.ts";
import { deployMedia, resolveMediaBucket } from "./media.ts";
import { seedTestUser, type TestUserCredentials } from "./seed.ts";

export interface DeployResult {
  apiUrl: string;
  adminUrl: string;
  testUser?: TestUserCredentials;
}

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const repoRoot = findRepoRoot(process.cwd());
  const log = createLogger();
  const prompter = createPrompter();

  try {
    const region = await resolveRegion({
      repoRoot,
      region: options.region,
      ask: prompter.ask,
      log,
      persist: !options.dryRun,
    });
    const clients = createAwsClients(region);

    const appPrefix = await resolveAppPrefix({
      repoRoot,
      prefix: options.prefix,
      ask: prompter.ask,
      log,
      persist: !options.dryRun,
    });

    const mediaBucket = await resolveMediaBucket({
      repoRoot,
      appPrefix,
      name: options.mediaBucket,
      ask: prompter.ask,
      log,
      persist: !options.dryRun,
    });

    const jwtSecret = resolveJwtSecret(repoRoot, !options.dryRun);

    const domains = await resolveDomains({
      repoRoot,
      adminDomain: options.adminDomain,
      apiDomain: options.apiDomain,
      hostedZone: options.hostedZone,
      noDomains: options.noDomains,
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
      region,
      accountId,
      dryRun: options.dryRun,
      repoRoot,
      appPrefix,
      mediaBucket,
      adminDomain: domains.adminDomain,
      apiDomain: domains.apiDomain,
      hostedZone: domains.hostedZone,
      log,
      clients,
    };

    const certificates = await ensureCertificates(ctx, !options.dryRun);
    ctx.adminCertificateArn = certificates.adminCertificateArn;
    ctx.adminCertificateIssued = certificates.adminCertificateIssued;
    ctx.apiCertificateArn = certificates.apiCertificateArn;

    log(
      options.dryRun
        ? `dry run for app "${appPrefix}" in ${region}: no AWS resources will be changed`
        : `deploying app "${appPrefix}" to account ${accountId} in ${region}`,
    );

    await deployMedia(ctx);
    const apiUrl = await deployApi(ctx, jwtSecret);
    const admin = await deployAdmin(ctx);

    log(`API URL:   ${apiUrl}`);
    log(`Admin URL: ${admin.url}`);

    let testUser: TestUserCredentials | undefined;
    if (!options.dryRun) {
      testUser = await seedTestUser({
        tableName: apiNames(appPrefix).usersTable,
        region,
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
