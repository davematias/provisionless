import type { AwsClients } from "../aws/clients.ts";
import type { Logger } from "../util/log.ts";

export interface DeployContext {
  region: string;
  accountId: string;
  dryRun: boolean;
  repoRoot: string;
  appPrefix: string;
  mediaBucket: string;
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
  adminCertificateArn?: string;
  apiCertificateArn?: string;
  log: Logger;
  clients: AwsClients;
}

export interface DeployOptions {
  region?: string;
  dryRun: boolean;
  prefix?: string;
  mediaBucket?: string;
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
  noDomains?: boolean;
  testUserUsername?: string;
  testUserPassword?: string;
}
