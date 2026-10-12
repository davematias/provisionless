import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  type ResourceRecordSet,
  type RRType,
  type Route53Client,
} from "@aws-sdk/client-route-53";

import type { DnsValidationRecord } from "./acm.ts";

const HOSTED_ZONE_ID = /^Z[0-9A-Z]+$/;
export const CLOUDFRONT_HOSTED_ZONE_ID = "Z2FDTNDATAQYW2";

export async function resolveHostedZoneId(client: Route53Client, zone: string): Promise<string> {
  if (HOSTED_ZONE_ID.test(zone)) {
    return zone;
  }

  const dnsName = zone.endsWith(".") ? zone : `${zone}.`;
  const result = await client.send(new ListHostedZonesByNameCommand({ DNSName: dnsName }));
  const found = result.HostedZones?.find(
    (candidate) => candidate.Name?.toLowerCase() === dnsName.toLowerCase(),
  );
  if (!found?.Id) {
    throw new Error(`Could not find a Route 53 hosted zone for "${zone}"`);
  }
  return found.Id.replace("/hostedzone/", "");
}

export async function upsertValidationRecords(
  client: Route53Client,
  hostedZoneId: string,
  records: DnsValidationRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: records.map((record) => ({
          Action: "UPSERT",
          ResourceRecordSet: {
            Name: record.name,
            Type: "CNAME",
            TTL: 300,
            ResourceRecords: [{ Value: record.value }],
          },
        })),
      },
    }),
  );
}

export interface AliasTarget {
  dnsName: string;
  hostedZoneId: string;
}

export async function upsertAliasRecords(
  client: Route53Client,
  hostedZoneId: string,
  names: string[],
  target: AliasTarget,
): Promise<void> {
  if (names.length === 0) {
    return;
  }

  const aliasTarget = {
    HostedZoneId: target.hostedZoneId,
    DNSName: target.dnsName,
    EvaluateTargetHealth: false,
  };

  const changes = names.flatMap((name) =>
    (["A", "AAAA"] as const).map((type) => ({
      Action: "UPSERT" as const,
      ResourceRecordSet: {
        Name: name,
        Type: type,
        AliasTarget: aliasTarget,
      },
    })),
  );

  await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: { Changes: changes },
    }),
  );
}

function normalize(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith(".") ? lower : `${lower}.`;
}

export function pickDomainRecords(
  records: ResourceRecordSet[],
  managedNames: string[],
): ResourceRecordSet[] {
  const managed = managedNames.map(normalize);
  const selected: ResourceRecordSet[] = [];
  for (const record of records) {
    const name = record.Name ? normalize(record.Name) : "";
    if (!name) {
      continue;
    }
    const isAlias = record.Type === "A" || record.Type === "AAAA";
    if (isAlias && record.AliasTarget && managed.includes(name)) {
      selected.push(record);
      continue;
    }
    const isValidation =
      record.Type === "CNAME" &&
      name.startsWith("_") &&
      (record.ResourceRecords?.some((rr) =>
        (rr.Value ?? "").toLowerCase().includes("acm-validations.aws"),
      ) ??
        false);
    if (isValidation && managed.some((fqdn) => name.endsWith(`.${fqdn}`))) {
      selected.push(record);
    }
  }
  return selected;
}

export async function listDomainRecords(
  client: Route53Client,
  hostedZoneId: string,
): Promise<ResourceRecordSet[]> {
  const collected: ResourceRecordSet[] = [];
  let startName: string | undefined;
  let startType: string | undefined;
  do {
    const page = await client.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        StartRecordName: startName,
        StartRecordType: startType as RRType | undefined,
      }),
    );
    collected.push(...(page.ResourceRecordSets ?? []));
    startName = page.IsTruncated ? page.NextRecordName : undefined;
    startType = page.IsTruncated ? page.NextRecordType : undefined;
  } while (startName);
  return collected;
}

export async function deleteRecords(
  client: Route53Client,
  hostedZoneId: string,
  records: ResourceRecordSet[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: records.map((record) => ({ Action: "DELETE", ResourceRecordSet: record })),
      },
    }),
  );
}
