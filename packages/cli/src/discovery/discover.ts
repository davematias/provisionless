import {
  GetResourcesCommand,
  type ResourceGroupsTaggingAPIClient,
} from "@aws-sdk/client-resource-groups-tagging-api";

import { MANAGED_TAG_KEY } from "../aws/tags.ts";
import type { TaggedResource } from "./types.ts";

export interface DiscoveryDependencies {
  tagging: (region: string) => Pick<ResourceGroupsTaggingAPIClient, "send">;
}

async function discoverRegion(
  region: string,
  client: Pick<ResourceGroupsTaggingAPIClient, "send">,
): Promise<TaggedResource[]> {
  const resources: TaggedResource[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(
      new GetResourcesCommand({
        TagFilters: [{ Key: MANAGED_TAG_KEY, Values: ["true"] }],
        PaginationToken: nextToken,
      }),
    );
    for (const mapping of page.ResourceTagMappingList ?? []) {
      if (!mapping.ResourceARN) {
        continue;
      }
      const tags: Record<string, string> = {};
      for (const tag of mapping.Tags ?? []) {
        if (tag.Key) {
          tags[tag.Key] = tag.Value ?? "";
        }
      }
      resources.push({ arn: mapping.ResourceARN, region, tags });
    }
    nextToken = page.PaginationToken;
  } while (nextToken);

  return resources;
}

/** Reads every Provisionless-managed resource in the given regions. */
export async function discoverTaggedResources(
  regions: string[],
  dependencies: DiscoveryDependencies,
): Promise<TaggedResource[]> {
  const results = await Promise.all(
    regions.map(async (region) => {
      try {
        return await discoverRegion(region, dependencies.tagging(region));
      } catch (error) {
        throw new Error(`Could not discover resources in ${region}: ${messageOf(error)}`, {
          cause: error,
        });
      }
    }),
  );

  const byArn = new Map<string, TaggedResource>();
  for (const resource of results.flat()) {
    if (!byArn.has(resource.arn)) {
      byArn.set(resource.arn, resource);
    }
  }
  return [...byArn.values()];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
