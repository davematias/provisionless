import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { ensureObservability } from "../aws/alarms.ts";
import { createAwsClients } from "../aws/clients.ts";
import { adminNames, apiNames } from "../aws/names.ts";
import {
  resolveAlarmEmail,
  resolveAppPrefix,
  resolveDomains,
  resolveEmailFrom,
  resolveJwtSecret,
  resolveLogRetention,
  resolveRegion,
} from "../config/config.ts";
import { createLogger } from "../util/log.ts";
import { createPrompter } from "../util/prompt.ts";
import { resolveProjectRoot } from "../util/repo.ts";
import { deployAdmin } from "./admin.ts";
import { configureApiAuth, deployApi } from "./api.ts";
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
  const project = resolveProjectRoot(process.cwd());
  const repoRoot = project.directory;
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
    const logRetention = resolveLogRetention({
      repoRoot,
      retention: options.logRetention,
      persist: !options.dryRun,
    });
    const emailFrom = resolveEmailFrom({
      repoRoot,
      emailFrom: options.emailFrom,
      log,
      persist: !options.dryRun,
    });
    const alarmEmail = resolveAlarmEmail({
      repoRoot,
      alarmEmail: options.alarmEmail,
      log,
      persist: !options.dryRun,
    });

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
      checkout: project.checkout,
      appPrefix,
      mediaBucket,
      emailFrom,
      alarmEmail,
      adminDomain: domains.adminDomain,
      apiDomain: domains.apiDomain,
      hostedZone: domains.hostedZone,
      logRetention,
      log,
      clients,
    };

    const certificates = await ensureCertificates(ctx, !options.dryRun);
    ctx.adminCertificateArn = certificates.adminCertificateArn;
    ctx.adminCertificateIssued = certificates.adminCertificateIssued;
    ctx.apiCertificateArn = certificates.apiCertificateArn;
    ctx.apiCertificateIssued = certificates.apiCertificateIssued;

    log(
      options.dryRun
        ? `dry run for app "${appPrefix}" in ${region}: no AWS resources will be changed`
        : `deploying app "${appPrefix}" to account ${accountId} in ${region}`,
    );

    await deployMedia(ctx);
    const apiUrl = await deployApi(ctx, jwtSecret);
    const admin = await deployAdmin(ctx, apiUrl);
    await configureApiAuth(ctx, jwtSecret, admin.url);

    const api = apiNames(appPrefix);
    const adminResources = adminNames(appPrefix, accountId);
    await ensureObservability(ctx, {
      apiId: ctx.apiId,
      functions: [
        { label: "api", name: api.function },
        { label: "admin-server", name: adminResources.serverFunction },
        { label: "admin-image", name: adminResources.imageFunction },
        { label: "admin-revalidation", name: adminResources.revalidationFunction },
      ],
      queueName: adminResources.revalidationQueue,
    });

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
        email: options.testUserEmail,
      });
      log(`test user login: ${testUser.username} / ${testUser.password}`);
      log(`test user email: ${testUser.email}`);
    }

    return { apiUrl, adminUrl: admin.url, testUser };
  } finally {
    prompter.close();
  }
}
