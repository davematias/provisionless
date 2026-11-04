import { GetDistributionCommand } from "@aws-sdk/client-cloudfront";
import {
  GetApiCommand,
  GetDomainNamesCommand,
  GetStagesCommand,
} from "@aws-sdk/client-apigatewayv2";
import { GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import { expect, it } from "vitest";

import type { DiscoveryClients } from "../discovery/clients.ts";
import type { TaggedResource } from "../discovery/types.ts";
import { listDeployments } from "./list.ts";

const TAGS = { "provisionless:managed": "true", "provisionless:app": "demo" };

function resource(arn: string, region: string): TaggedResource {
  return { arn, region, tags: TAGS };
}

function clients(options: {
  regions?: string[];
  byRegion?: (region: string) => TaggedResource[];
  denied?: boolean;
  writes?: string[];
}): DiscoveryClients {
  return {
    account: {
      send: async () => ({
        Regions: (options.regions ?? ["eu-west-1"]).map((region) => ({
          RegionName: region,
          RegionOptStatus: "ENABLED",
        })),
      }),
    },
    tagging: (region: string) => ({
      send: async (command: unknown) => {
        options.writes?.push((command as { constructor: { name: string } }).constructor.name);
        if (options.denied) {
          const error = new Error("denied");
          error.name = "AccessDeniedException";
          throw error;
        }
        expect(command).toBeInstanceOf(GetResourcesCommand);
        return {
          ResourceTagMappingList: (options.byRegion?.(region) ?? []).map((item) => ({
            ResourceARN: item.arn,
            Tags: Object.entries(item.tags).map(([Key, Value]) => ({ Key, Value })),
          })),
        };
      },
    }),
    cloudfront: {
      send: async (command: unknown) => {
        options.writes?.push((command as { constructor: { name: string } }).constructor.name);
        expect(command).toBeInstanceOf(GetDistributionCommand);
        return {
          Distribution: {
            DomainName: "d111.cloudfront.net",
            Status: "Deployed",
            DistributionConfig: { Aliases: { Quantity: 1, Items: ["admin.example.com"] } },
          },
        };
      },
    },
    apiGateway: () => ({
      send: async (command: unknown) => {
        options.writes?.push((command as { constructor: { name: string } }).constructor.name);
        if (command instanceof GetApiCommand) {
          return { ApiEndpoint: "https://api1.execute-api.eu-west-1.amazonaws.com" };
        }
        if (command instanceof GetStagesCommand) {
          return { Items: [{ StageName: "$default" }] };
        }
        if (command instanceof GetDomainNamesCommand) {
          return { Items: [] };
        }
        throw new Error("unexpected command");
      },
    }),
  } as unknown as DiscoveryClients;
}

function demoResources(): TaggedResource[] {
  return [
    resource("arn:aws:lambda:eu-west-1:111122223333:function:demo-api", "eu-west-1"),
    resource("arn:aws:apigateway:eu-west-1::/apis/api1", "eu-west-1"),
    resource("arn:aws:cloudfront::111122223333:distribution/DIST1", "us-east-1"),
  ];
}

it("discovers deployments across enabled regions and prints a table", async () => {
  const output: string[] = [];
  const deployments = await listDeployments(
    { json: false },
    {
      clients: clients({ byRegion: () => demoResources() }),
      write: (text) => output.push(text),
    },
  );

  expect(deployments).toHaveLength(1);
  expect(deployments[0]?.prefix).toBe("demo");
  expect(deployments[0]?.health).toBe("healthy");
  expect(output[0]).toContain("PREFIX");
  expect(output[0]).toContain("https://admin.example.com");
});

it("prints JSON with the list summary fields", async () => {
  const output: string[] = [];
  await listDeployments(
    { json: true },
    {
      clients: clients({ byRegion: () => demoResources() }),
      write: (text) => output.push(text),
    },
  );

  expect(JSON.parse(output[0] ?? "[]")).toEqual([
    {
      prefix: "demo",
      region: "eu-west-1",
      adminUrl: "https://admin.example.com",
      apiUrl: "https://api1.execute-api.eu-west-1.amazonaws.com",
      health: "healthy",
    },
  ]);
});

it("honours a region filter without listing regions", async () => {
  let accountCalls = 0;
  const base = clients({ byRegion: () => demoResources() });
  const filtered = {
    ...base,
    account: {
      send: async () => {
        accountCalls += 1;
        return { Regions: [] };
      },
    },
  } as unknown as DiscoveryClients;

  await listDeployments(
    { json: false, region: "eu-west-1" },
    { clients: filtered, write: () => undefined },
  );

  expect(accountCalls).toBe(0);
});

it("reports an empty account clearly", async () => {
  const output: string[] = [];
  await listDeployments(
    { json: false },
    {
      clients: clients({ byRegion: () => [] }),
      write: (text) => output.push(text),
    },
  );

  expect(output[0]).toContain("No Provisionless deployments found in eu-west-1");
});

it("explains denied tag reads", async () => {
  await expect(
    listDeployments(
      { json: false },
      { clients: clients({ denied: true }), write: () => undefined },
    ),
  ).rejects.toThrow(/AWS denied permission while trying to list deployments/);
});

it("issues only read operations", async () => {
  const writes: string[] = [];
  await listDeployments(
    { json: false },
    {
      clients: clients({ byRegion: () => demoResources(), writes }),
      write: () => undefined,
    },
  );

  expect(writes.every((name) => /^(Get|List)/u.test(name))).toBe(true);
});
