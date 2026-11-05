import { ListRegionsCommand, type AccountClient } from "@aws-sdk/client-account";

const ENABLED_STATUSES = new Set(["ENABLED", "ENABLED_BY_DEFAULT"]);

/** Returns the account's enabled regions, falling back to the configured region when none load. */
export async function enabledRegions(
  client: Pick<AccountClient, "send">,
  fallback: string,
): Promise<string[]> {
  const regions: string[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(new ListRegionsCommand({ NextToken: nextToken }));
    for (const region of page.Regions ?? []) {
      if (
        region.RegionName &&
        region.RegionOptStatus &&
        ENABLED_STATUSES.has(region.RegionOptStatus)
      ) {
        regions.push(region.RegionName);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);

  return regions.length > 0 ? [...new Set(regions)].sort() : [fallback];
}

/** Parses a comma-separated region option, falling back to the configured region. */
export function parseRegionOption(value: string | undefined, fallback: string): string[] {
  if (!value) {
    return [fallback];
  }
  const regions = value
    .split(",")
    .map((region) => region.trim())
    .filter((region) => region.length > 0);
  if (regions.length === 0) {
    throw new Error("--region must name at least one region.");
  }
  return [...new Set(regions)];
}
