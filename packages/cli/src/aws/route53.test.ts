import { expect, it } from "vitest";

import type { ResourceRecordSet, Route53Client } from "@aws-sdk/client-route-53";

import { pickDomainRecords, upsertAliasRecords } from "./route53.ts";

interface ChangeInput {
  HostedZoneId?: string;
  ChangeBatch?: {
    Changes?: Array<{
      Action?: string;
      ResourceRecordSet?: {
        Name?: string;
        Type?: string;
        AliasTarget?: { DNSName?: string; HostedZoneId?: string };
      };
    }>;
  };
}

it("upserts A and AAAA alias records for every name", async () => {
  const commands: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  } as unknown as Route53Client;

  await upsertAliasRecords(client, "Z0123456789", ["example.com", "www.example.com"], {
    dnsName: "distribution.cloudfront.net",
    hostedZoneId: "Z2FDTNDATAQYW2",
  });

  expect(commands).toHaveLength(1);
  const input = (commands[0] as { input: ChangeInput }).input;
  expect(input.HostedZoneId).toBe("Z0123456789");
  const changes = input.ChangeBatch?.Changes ?? [];
  expect(changes).toHaveLength(4);
  expect(changes.every((change) => change.Action === "UPSERT")).toBe(true);
  expect(changes.map((change) => change.ResourceRecordSet?.Name)).toEqual([
    "example.com",
    "example.com",
    "www.example.com",
    "www.example.com",
  ]);
  expect(changes.map((change) => change.ResourceRecordSet?.Type)).toEqual([
    "A",
    "AAAA",
    "A",
    "AAAA",
  ]);
  expect(
    changes.every(
      (change) =>
        change.ResourceRecordSet?.AliasTarget?.DNSName === "distribution.cloudfront.net" &&
        change.ResourceRecordSet?.AliasTarget?.HostedZoneId === "Z2FDTNDATAQYW2",
    ),
  ).toBe(true);
});

it("does nothing when there are no names", async () => {
  const commands: unknown[] = [];
  const client = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  } as unknown as Route53Client;

  await upsertAliasRecords(client, "Z0123456789", [], {
    dnsName: "distribution.cloudfront.net",
    hostedZoneId: "Z2FDTNDATAQYW2",
  });

  expect(commands).toEqual([]);
});

const alias = (name: string, type: "A" | "AAAA"): ResourceRecordSet => ({
  Name: name,
  Type: type,
  AliasTarget: { DNSName: "dist.cloudfront.net", HostedZoneId: "Z2FDTNDATAQYW2" },
});

it("selects alias records only for the managed names", () => {
  const records: ResourceRecordSet[] = [
    alias("example.com.", "A"),
    alias("example.com.", "AAAA"),
    alias("www.example.com.", "A"),
    alias("other.example.com.", "A"),
    { Name: "example.com.", Type: "MX", ResourceRecords: [{ Value: "10 mail.example.com." }] },
  ];

  const picked = pickDomainRecords(records, ["example.com", "www.example.com"]);
  expect(picked.map((record) => `${record.Name}:${record.Type}`)).toEqual([
    "example.com.:A",
    "example.com.:AAAA",
    "www.example.com.:A",
  ]);
});

it("selects ACM validation CNAMEs belonging to managed names only", () => {
  const records: ResourceRecordSet[] = [
    {
      Name: "_abc.admin.example.com.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: "_xyz.acm-validations.aws." }],
    },
    {
      Name: "_def.example.com.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: "_uvw.acm-validations.aws." }],
    },
    {
      Name: "_ghi.other.test.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: "_nop.acm-validations.aws." }],
    },
    {
      Name: "eviladmin.example.com.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: "_x.acm-validations.aws." }],
    },
    {
      Name: "_jkl.admin.example.com.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: "elsewhere.example.net." }],
    },
  ];

  const picked = pickDomainRecords(records, ["admin.example.com"]);
  expect(picked.map((record) => record.Name)).toEqual(["_abc.admin.example.com."]);
});

it("is case-insensitive and tolerates names without trailing dots", () => {
  const records: ResourceRecordSet[] = [alias("EXAMPLE.COM", "A")];
  const picked = pickDomainRecords(records, ["example.com"]);
  expect(picked).toHaveLength(1);
});
