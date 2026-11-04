import type { Command } from "commander";

import { formatCommandHelp } from "../cli/help.ts";
import { COMMAND_HELP } from "../cli/metadata.ts";
import { createDiscoveryClients, type DiscoveryClients } from "../discovery/clients.ts";
import { discoverTaggedResources } from "../discovery/discover.ts";
import { formatDeploymentTable, listJson } from "../discovery/format.ts";
import { enabledRegions, parseRegionOption } from "../discovery/regions.ts";
import { groupDeployments } from "../discovery/resources.ts";
import type { Deployment } from "../discovery/types.ts";
import { hydrateDeployments } from "../discovery/urls.ts";
import { describeAwsError } from "../util/aws.ts";

export interface ListOptions {
  region?: string;
  json: boolean;
}

export interface ListDependencies {
  clients?: DiscoveryClients;
  write?: (text: string) => void;
}

export function configuredRegion(): string {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
}

/** Discovers Provisionless deployments across the account's enabled regions. */
export async function listDeployments(
  options: ListOptions,
  dependencies: ListDependencies = {},
): Promise<Deployment[]> {
  const fallback = configuredRegion();
  const clients = dependencies.clients ?? createDiscoveryClients(fallback);
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));

  try {
    const regions = options.region
      ? parseRegionOption(options.region, fallback)
      : await enabledRegions(clients.account, fallback);
    // Global anchors (CloudFront, IAM, S3) are tagged in us-east-1, so include it when a filter is
    // used; the filter still limits which deployment regions are reported.
    const discoveryRegions = options.region ? [...new Set([...regions, "us-east-1"])] : regions;
    const resources = await discoverTaggedResources(discoveryRegions, clients);
    const deployments = (await hydrateDeployments(groupDeployments(resources), clients)).filter(
      (deployment) => !options.region || regions.includes(deployment.region),
    );

    if (options.json) {
      write(`${JSON.stringify(listJson(deployments), null, 2)}\n`);
    } else if (deployments.length === 0) {
      write(`No Provisionless deployments found in ${regions.join(", ")}.\n`);
    } else {
      write(formatDeploymentTable(deployments));
    }
    return deployments;
  } catch (error) {
    throw describeAwsError(error, "list deployments");
  }
}

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description(COMMAND_HELP.list.summary)
    .option(
      "-r, --region <regions>",
      "Comma-separated regions to search (default: all enabled regions)",
    )
    .option("--json", "Output deployments as JSON", false)
    .addHelpText("after", formatCommandHelp(COMMAND_HELP.list))
    .action(async (options: ListOptions) => {
      await listDeployments(options);
    });
}
