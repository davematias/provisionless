import type { AwsClients } from "../aws/clients.ts";
import type { Logger } from "../util/log.ts";

export interface DeployContext {
  region: string;
  accountId: string;
  dryRun: boolean;
  repoRoot: string;
  appPrefix: string;
  log: Logger;
  clients: AwsClients;
}

export interface DeployOptions {
  region: string;
  dryRun: boolean;
  prefix?: string;
  testUserUsername?: string;
  testUserPassword?: string;
}
