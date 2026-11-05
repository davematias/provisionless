import {
  GetApiCommand,
  GetDomainNamesCommand,
  GetStagesCommand,
} from "@aws-sdk/client-apigatewayv2";
import { GetDistributionCommand } from "@aws-sdk/client-cloudfront";
import { GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import { expect, it } from "vitest";

import type { DiscoveryClients } from "../discovery/clients.ts";
import type { TaggedResource } from "../discovery/types.ts";
import { statusDeployment } from "./status.ts";

const TAGS = { "provisionless:managed": "true", "provisionless:app": "demo" };

function resource(arn: string, region: string, tags = TAGS): TaggedResource {
  return { arn, region, tags };
}

function demoResources(region = "eu-west-1"): TaggedResource[] {
  return [
    resource(`arn:aws:lambda:${region}:111122223333:function:demo-api`, region),
    resource(`arn:aws:apigateway:${region}::/apis/api1`, region),
    resource("arn:aws:cloudfront::111122223333:distribution/DIST1", "us-east-1"),
  ];
}

function clients(options: {
  regions?: string[];
  byRegion?: (region: string) => TaggedResource[];
  denied?: boolean;
  regionsQueried?: string[];
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
        options.regionsQueried?.push(region);
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

it("shows one deployment by prefix", async () => {
  const output: string[] = [];
  const deployment = await statusDeployment(
    { prefix: "demo", json: false, check: false },
    {
      clients: clients({ byRegion: () => demoResources() }),
      write: (text) => output.push(text),
    },
  );

  expect(deployment.region).toBe("eu-west-1");
  expect(output[0]).toContain("Deployment demo (eu-west-1)");
  expect(output[0]).toContain("Health: healthy");
});

it("prints status JSON", async () => {
  const output: string[] = [];
  await statusDeployment(
    { prefix: "demo", json: true, check: false },
    {
      clients: clients({ byRegion: () => demoResources() }),
      write: (text) => output.push(text),
    },
  );

  const parsed = JSON.parse(output[0] ?? "{}") as { prefix: string; adminUrl?: string };
  expect(parsed.prefix).toBe("demo");
  expect(parsed.adminUrl).toBe("https://admin.example.com");
});

it("includes us-east-1 when a single region is requested for global resources", async () => {
  const queried: string[] = [];
  await statusDeployment(
    { prefix: "demo", region: "eu-west-1", json: false, check: false },
    {
      clients: clients({ byRegion: () => demoResources(), regionsQueried: queried }),
      write: () => undefined,
    },
  );

  expect(queried.sort()).toEqual(["eu-west-1", "us-east-1"]);
});

it("runs live checks when enabled", async () => {
  const output: string[] = [];
  await statusDeployment(
    { prefix: "demo", json: false, check: true },
    {
      clients: clients({ byRegion: () => demoResources() }),
      write: (text) => output.push(text),
      fetchImpl: async () => new Response("ok", { status: 200 }),
    },
  );

  expect(output[0]).toContain("Checks:");
  expect(output[0]).toContain("reachable (HTTP 200)");
});

it("fails with guidance when the prefix is not found", async () => {
  await expect(
    statusDeployment(
      { prefix: "missing", json: false, check: false },
      {
        clients: clients({ byRegion: () => demoResources() }),
        write: () => undefined,
      },
    ),
  ).rejects.toThrow(/No Provisionless deployment with prefix "missing"/);
});

it("asks for a region when the prefix exists in several regions", async () => {
  await expect(
    statusDeployment(
      { prefix: "demo", json: false, check: false },
      {
        clients: clients({
          regions: ["eu-west-1", "us-east-1"],
          byRegion: (region) => demoResources(region),
        }),
        write: () => undefined,
      },
    ),
  ).rejects.toThrow(/exists in multiple regions/);
});

it("explains denied tag reads", async () => {
  await expect(
    statusDeployment(
      { prefix: "demo", json: false, check: false },
      { clients: clients({ denied: true }), write: () => undefined },
    ),
  ).rejects.toThrow(/AWS denied permission while trying to inspect deployment demo/);
});
