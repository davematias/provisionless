import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { createAwsClients } from "../aws/clients.ts";
import { createLogger } from "../util/log.ts";
import { findRepoRoot } from "../util/repo.ts";
import { deployAdmin } from "./admin.ts";
import { deployApi } from "./api.ts";
import type { DeployContext, DeployOptions } from "./context.ts";

export interface DeployResult {
  apiUrl: string;
  adminUrl: string;
}

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const repoRoot = findRepoRoot(process.cwd());
  const clients = createAwsClients(options.region);
  const log = createLogger();

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
    log,
    clients,
  };

  log(
    options.dryRun
      ? "dry run: no AWS resources will be changed"
      : `deploying to account ${accountId} in ${options.region}`,
  );

  const apiUrl = await deployApi(ctx);
  const admin = await deployAdmin(ctx);

  log(`API URL:   ${apiUrl}`);
  log(`Admin URL: ${admin.url}`);

  return { apiUrl, adminUrl: admin.url };
}
