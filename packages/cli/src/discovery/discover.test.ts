import { GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import { expect, it } from "vitest";

import { discoverTaggedResources } from "./discover.ts";

it("paginates tagged resources per region and dedupes ARNs", async () => {
  const commands: GetResourcesCommand[] = [];
  let page = 0;
  const client = {
    send: async (command: unknown) => {
      commands.push(command as GetResourcesCommand);
      page += 1;
      if (page === 1) {
        return {
          ResourceTagMappingList: [
            {
              ResourceARN: "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
              Tags: [
                { Key: "provisionless:managed", Value: "true" },
                { Key: "provisionless:app", Value: "demo" },
              ],
            },
          ],
          PaginationToken: "page-2",
        };
      }
      return {
        ResourceTagMappingList: [
          {
            ResourceARN: "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
            Tags: [{ Key: "provisionless:managed", Value: "true" }],
          },
          {
            ResourceARN: "arn:aws:dynamodb:eu-west-1:111122223333:table/demo-users",
            Tags: [],
          },
        ],
      };
    },
  };

  const resources = await discoverTaggedResources(["eu-west-1"], {
    tagging: () => client,
  });

  expect(resources).toHaveLength(2);
  expect(resources.map((resource) => resource.arn)).toEqual([
    "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
    "arn:aws:dynamodb:eu-west-1:111122223333:table/demo-users",
  ]);
  expect(resources[0]?.region).toBe("eu-west-1");
  expect(resources[0]?.tags).toEqual({
    "provisionless:managed": "true",
    "provisionless:app": "demo",
  });
  expect(commands).toHaveLength(2);
  expect(commands[0]?.input.TagFilters).toEqual([
    { Key: "provisionless:managed", Values: ["true"] },
  ]);
  expect(commands[1]?.input.PaginationToken).toBe("page-2");
});

it("reports which region failed and preserves the AWS error cause", async () => {
  const denied = new Error("denied");
  denied.name = "AccessDeniedException";
  const client = {
    send: async () => {
      throw denied;
    },
  };

  await expect(
    discoverTaggedResources(["eu-west-1"], { tagging: () => client }),
  ).rejects.toMatchObject({
    message: expect.stringContaining("eu-west-1"),
    cause: denied,
  });
});

it("issues only GetResources reads", async () => {
  const names: string[] = [];
  const client = {
    send: async (command: unknown) => {
      names.push((command as { constructor: { name: string } }).constructor.name);
      return { ResourceTagMappingList: [] };
    },
  };

  await discoverTaggedResources(["eu-west-1", "us-east-1"], { tagging: () => client });

  expect(names).toEqual(["GetResourcesCommand", "GetResourcesCommand"]);
});
