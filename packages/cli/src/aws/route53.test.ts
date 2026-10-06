import { expect, it } from "vitest";

import type { Route53Client } from "@aws-sdk/client-route-53";

import { upsertAliasRecords } from "./route53.ts";

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

  await upsertAliasRecords(
    client,
    "Z0123456789",
    ["example.com", "www.example.com"],
    "distribution.cloudfront.net",
  );

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

  await upsertAliasRecords(client, "Z0123456789", [], "distribution.cloudfront.net");

  expect(commands).toEqual([]);
});
