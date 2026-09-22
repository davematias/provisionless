import type { ACMClient } from "@aws-sdk/client-acm";
import type { Route53Client } from "@aws-sdk/client-route-53";

import {
  ensureCertificate,
  waitForCertificateIssued,
  type DnsValidationRecord,
} from "../aws/acm.ts";
import { resolveHostedZoneId, upsertValidationRecords } from "../aws/route53.ts";
import { loadConfig, updateConfig, type ProvisionlessConfig } from "../config/config.ts";
import type { Logger } from "../util/log.ts";
import type { DeployContext } from "./context.ts";

export interface CertificateResult {
  adminCertificateArn?: string;
  apiCertificateArn?: string;
}

interface EnsureDomainCertificateOptions {
  client: ACMClient;
  domain: string;
  existingArn?: string;
  useHostedZone: boolean;
  hostedZoneId?: string;
  route53: Route53Client;
  dryRun: boolean;
  log: Logger;
}

function printValidationInstructions(
  log: Logger,
  domain: string,
  records: DnsValidationRecord[],
): void {
  log(`ACM certificate for ${domain} is pending DNS validation.`);
  if (records.length === 0) {
    log(`Open the ACM console and complete validation for ${domain}, then re-run deploy.`);
    return;
  }

  log("Add these CNAME records to your DNS provider:");
  for (const record of records) {
    log(`  ${record.name} -> ${record.value}`);
  }
  log(`Re-run deploy once ${domain} is validated to continue.`);
}

async function ensureDomainCertificate(
  options: EnsureDomainCertificateOptions,
): Promise<{ certificateArn?: string }> {
  const ensured = await ensureCertificate({
    client: options.client,
    domain: options.domain,
    existingArn: options.existingArn,
    dryRun: options.dryRun,
    log: options.log,
  });

  if (!ensured.certificateArn) {
    return {};
  }
  if (ensured.issued) {
    return { certificateArn: ensured.certificateArn };
  }

  if (!options.useHostedZone) {
    printValidationInstructions(options.log, options.domain, ensured.records);
    return { certificateArn: ensured.certificateArn };
  }

  if (ensured.records.length > 0) {
    if (options.dryRun || options.hostedZoneId === undefined) {
      options.log(`would create ACM validation records for ${options.domain}`);
    } else {
      options.log(`creating ACM validation records for ${options.domain}`);
      await upsertValidationRecords(options.route53, options.hostedZoneId, ensured.records);
    }
  }

  if (!options.dryRun) {
    options.log(`waiting for the ACM certificate for ${options.domain} to be issued`);
    await waitForCertificateIssued(options.client, ensured.certificateArn, options.log);
  }

  return { certificateArn: ensured.certificateArn };
}

export async function ensureCertificates(
  ctx: DeployContext,
  persist: boolean,
): Promise<CertificateResult> {
  const result: CertificateResult = {};
  if (!ctx.adminDomain && !ctx.apiDomain) {
    return result;
  }

  const existing = loadConfig(ctx.repoRoot);
  const useHostedZone = ctx.hostedZone !== undefined;
  const hostedZoneId =
    useHostedZone && !ctx.dryRun
      ? await resolveHostedZoneId(ctx.clients.route53, ctx.hostedZone ?? "")
      : undefined;

  if (ctx.adminDomain) {
    const admin = await ensureDomainCertificate({
      client: ctx.clients.acmUsEast1,
      domain: ctx.adminDomain,
      existingArn: existing?.adminCertificateArn,
      useHostedZone,
      hostedZoneId,
      route53: ctx.clients.route53,
      dryRun: ctx.dryRun,
      log: ctx.log,
    });
    result.adminCertificateArn = admin.certificateArn;
  }

  if (ctx.apiDomain) {
    const api = await ensureDomainCertificate({
      client: ctx.clients.acm,
      domain: ctx.apiDomain,
      existingArn: existing?.apiCertificateArn,
      useHostedZone,
      hostedZoneId,
      route53: ctx.clients.route53,
      dryRun: ctx.dryRun,
      log: ctx.log,
    });
    result.apiCertificateArn = api.certificateArn;
  }

  if (persist) {
    const patch: Partial<ProvisionlessConfig> = {};
    if (ctx.adminDomain) {
      patch.adminCertificateArn = result.adminCertificateArn;
    }
    if (ctx.apiDomain) {
      patch.apiCertificateArn = result.apiCertificateArn;
    }
    if (Object.keys(patch).length > 0) {
      updateConfig(ctx.repoRoot, patch);
    }
  }

  return result;
}
