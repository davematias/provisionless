import type { AccountClient } from "@aws-sdk/client-account";
import { ListRegionsCommand } from "@aws-sdk/client-account";
import { expect, it } from "vitest";

import { enabledRegions, parseRegionOption } from "./regions.ts";

it("returns enabled and default-enabled regions, sorted and paginated", async () => {
  const commands: ListRegionsCommand[] = [];
  let page = 0;
  const client = {
    send: async (command: unknown) => {
      commands.push(command as ListRegionsCommand);
      page += 1;
      if (page === 1) {
        return {
          Regions: [
            { RegionName: "eu-west-1", RegionOptStatus: "ENABLED" },
            { RegionName: "ap-south-1", RegionOptStatus: "DISABLED" },
            { RegionName: "us-east-1", RegionOptStatus: "ENABLED_BY_DEFAULT" },
          ],
          NextToken: "next",
        };
      }
      return { Regions: [{ RegionName: "us-west-2", RegionOptStatus: "ENABLED" }] };
    },
  } as unknown as Pick<AccountClient, "send">;

  const regions = await enabledRegions(client, "us-east-1");

  expect(regions).toEqual(["eu-west-1", "us-east-1", "us-west-2"]);
  expect(commands).toHaveLength(2);
});

it("falls back to the configured region when no regions are enabled", async () => {
  const client = {
    send: async () => ({ Regions: [] }),
  } as unknown as Pick<AccountClient, "send">;

  expect(await enabledRegions(client, "eu-central-1")).toEqual(["eu-central-1"]);
});

it("parses a comma-separated region option without duplicates", () => {
  expect(parseRegionOption(undefined, "eu-west-1")).toEqual(["eu-west-1"]);
  expect(parseRegionOption(" us-east-1, eu-west-1 ,us-east-1 ", "eu-west-1")).toEqual([
    "us-east-1",
    "eu-west-1",
  ]);
  expect(() => parseRegionOption(" , ", "eu-west-1")).toThrow(/at least one region/);
});
