import {
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
  type ACMClient,
  type CertificateDetail,
  type CertificateStatus,
  type DomainValidation,
} from "@aws-sdk/client-acm";

import { isAwsError, sleep } from "../util/aws.ts";
import type { Logger } from "../util/log.ts";

export interface DnsValidationRecord {
  name: string;
  value: string;
}

export interface EnsuredCertificate {
  certificateArn?: string;
  records: DnsValidationRecord[];
  issued: boolean;
}

export interface EnsureCertificateOptions {
  client: ACMClient;
  domain: string;
  additionalDomains?: string[];
  existingArn?: string;
  dryRun: boolean;
  log: Logger;
}

const REUSABLE_STATUSES: readonly CertificateStatus[] = ["ISSUED", "PENDING_VALIDATION"];

function recordsFromValidation(validation: DomainValidation[] | undefined): DnsValidationRecord[] {
  const records: DnsValidationRecord[] = [];
  for (const entry of validation ?? []) {
    const record = entry.ResourceRecord;
    if (record?.Name && record.Value) {
      records.push({ name: record.Name, value: record.Value });
    }
  }
  return records;
}

function coversDomains(certificate: CertificateDetail, domains: string[]): boolean {
  const issued = new Set<string>([certificate.DomainName ?? ""]);
  for (const alt of certificate.SubjectAlternativeNames ?? []) {
    issued.add(alt);
  }
  return domains.every((domain) => issued.has(domain));
}

function toEnsured(
  certificate: CertificateDetail | undefined,
  domains: string[],
): EnsuredCertificate | undefined {
  if (!certificate?.CertificateArn || !coversDomains(certificate, domains)) {
    return undefined;
  }
  if (certificate.Status === undefined || !REUSABLE_STATUSES.includes(certificate.Status)) {
    return undefined;
  }
  return {
    certificateArn: certificate.CertificateArn,
    records: recordsFromValidation(certificate.DomainValidationOptions),
    issued: certificate.Status === "ISSUED",
  };
}

async function describeReusable(
  client: ACMClient,
  certificateArn: string | undefined,
  domains: string[],
): Promise<EnsuredCertificate | undefined> {
  if (!certificateArn) {
    return undefined;
  }
  try {
    const detail = await client.send(
      new DescribeCertificateCommand({ CertificateArn: certificateArn }),
    );
    return toEnsured(detail.Certificate, domains);
  } catch (error) {
    if (isAwsError(error, "ResourceNotFoundException")) {
      return undefined;
    }
    throw error;
  }
}

async function findByDomain(
  client: ACMClient,
  domains: string[],
): Promise<EnsuredCertificate | undefined> {
  let nextToken: string | undefined;
  do {
    const listed = await client.send(new ListCertificatesCommand({ NextToken: nextToken }));
    const candidates = (listed.CertificateSummaryList ?? []).filter(
      (summary) =>
        summary.DomainName === domains[0] &&
        summary.Status !== undefined &&
        REUSABLE_STATUSES.includes(summary.Status),
    );
    const chosen = candidates.find((summary) => summary.Status === "ISSUED") ?? candidates[0];
    if (chosen?.CertificateArn) {
      const detail = await client.send(
        new DescribeCertificateCommand({ CertificateArn: chosen.CertificateArn }),
      );
      return toEnsured(detail.Certificate, domains);
    }
    nextToken = listed.NextToken;
  } while (nextToken);

  return undefined;
}

export async function ensureCertificate(
  options: EnsureCertificateOptions,
): Promise<EnsuredCertificate> {
  const { client } = options;
  const domains = [options.domain, ...(options.additionalDomains ?? [])];

  if (options.dryRun) {
    options.log(`would ensure an ACM certificate for ${domains.join(", ")}`);
    return { certificateArn: options.existingArn, records: [], issued: false };
  }

  const reusable =
    (await describeReusable(client, options.existingArn, domains)) ??
    (await findByDomain(client, domains));
  if (reusable) {
    options.log(`reusing ACM certificate for ${domains.join(", ")}`);
    return reusable;
  }

  options.log(`requesting ACM certificate for ${domains.join(", ")}`);
  const requested = await client.send(
    new RequestCertificateCommand({
      DomainName: options.domain,
      ...(options.additionalDomains && options.additionalDomains.length > 0
        ? { SubjectAlternativeNames: options.additionalDomains }
        : {}),
      ValidationMethod: "DNS",
    }),
  );
  if (!requested.CertificateArn) {
    throw new Error(`ACM did not return a certificate ARN for ${options.domain}`);
  }

  const detail = await client.send(
    new DescribeCertificateCommand({ CertificateArn: requested.CertificateArn }),
  );
  return (
    toEnsured(detail.Certificate, domains) ?? {
      certificateArn: requested.CertificateArn,
      records: [],
      issued: false,
    }
  );
}

export async function waitForCertificateIssued(
  client: ACMClient,
  certificateArn: string,
  log: Logger,
  attempts = 60,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const detail = await client.send(
      new DescribeCertificateCommand({ CertificateArn: certificateArn }),
    );
    const status = detail.Certificate?.Status;
    if (status === "ISSUED") {
      return;
    }
    if (status === "FAILED" || status === "VALIDATION_TIMED_OUT" || status === "REVOKED") {
      throw new Error(`ACM certificate ${certificateArn} is ${status}`);
    }
    log(`waiting for ACM certificate ${certificateArn} to be issued (${status ?? "PENDING"})`);
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for ACM certificate ${certificateArn} to be issued`);
}
