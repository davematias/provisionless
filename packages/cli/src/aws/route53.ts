import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  type Route53Client,
} from "@aws-sdk/client-route-53";

import type { DnsValidationRecord } from "./acm.ts";

const HOSTED_ZONE_ID = /^Z[0-9A-Z]+$/;

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
