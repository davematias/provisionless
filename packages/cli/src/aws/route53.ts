import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  type Route53Client,
} from "@aws-sdk/client-route-53";

import type { DnsValidationRecord } from "./acm.ts";

const HOSTED_ZONE_ID = /^Z[0-9A-Z]+$/;
const CLOUDFRONT_HOSTED_ZONE_ID = "Z2FDTNDATAQYW2";

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

export async function upsertAliasRecords(
  client: Route53Client,
  hostedZoneId: string,
  names: string[],
  distributionDomain: string,
): Promise<void> {
  if (names.length === 0) {
    return;
  }

  const aliasTarget = {
    HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
    DNSName: distributionDomain,
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
