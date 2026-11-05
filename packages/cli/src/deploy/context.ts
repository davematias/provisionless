import type { AwsClients } from "../aws/clients.ts";
import type { Logger } from "../util/log.ts";

export interface DeployContext {
  region: string;
  accountId: string;
  dryRun: boolean;
  repoRoot: string;
  /** Whether the project root is a Provisionless source checkout; defaults to true. */
  checkout?: boolean;
  appPrefix: string;
  mediaBucket: string;
  /** API Gateway HTTP API ID, set once the API has been created or found. */
  apiId?: string;
  emailFrom?: string;
  /** Optional email address subscribed to the deployment's alarm topic. */
  alarmEmail?: string;
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
  adminCertificateArn?: string;
  adminCertificateIssued?: boolean;
  apiCertificateArn?: string;
  apiCertificateIssued?: boolean;
  /** Days Lambda logs are retained; defaults to 30. */
  logRetention?: number;
  log: Logger;
  clients: AwsClients;
}

export interface DeployOptions {
  region?: string;
  dryRun: boolean;
  prefix?: string;
  mediaBucket?: string;
  emailFrom?: string;
  alarmEmail?: string;
  adminDomain?: string;
  apiDomain?: string;
  hostedZone?: string;
  noDomains?: boolean;
  logRetention?: number;
  testUserUsername?: string;
  testUserPassword?: string;
  testUserEmail?: string;
}
