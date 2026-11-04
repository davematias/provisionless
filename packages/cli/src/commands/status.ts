import type { Command } from "commander";

import { formatCommandHelp } from "../cli/help.ts";
import { COMMAND_HELP } from "../cli/metadata.ts";
import { createDiscoveryClients, type DiscoveryClients } from "../discovery/clients.ts";
import { applyChecks, checkDeployment } from "../discovery/checks.ts";
import { discoverTaggedResources } from "../discovery/discover.ts";
import { formatDeploymentStatus, statusJson } from "../discovery/format.ts";
import { enabledRegions, parseRegionOption } from "../discovery/regions.ts";
import { groupDeployments } from "../discovery/resources.ts";
import type { Deployment } from "../discovery/types.ts";
import { hydrateDeployment } from "../discovery/urls.ts";
import { describeAwsError } from "../util/aws.ts";
import { configuredRegion } from "./list.ts";

export interface StatusOptions {
  prefix: string;
  region?: string;
  json: boolean;
  check: boolean;
}

export interface StatusDependencies {
  clients?: DiscoveryClients;
  write?: (text: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Inspects one Provisionless deployment by prefix and optional region. */
export async function statusDeployment(
  options: StatusOptions,
  dependencies: StatusDependencies = {},
): Promise<Deployment> {
  const fallback = configuredRegion();
  const clients = dependencies.clients ?? createDiscoveryClients(fallback);
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));

  try {
    const regions = options.region
      ? parseRegionOption(options.region, fallback)
      : await enabledRegions(clients.account, fallback);
    // Global services (CloudFront, IAM, S3) are tagged in us-east-1, so include it when a single
    // region was requested.
    const discoveryRegions = options.region ? [...new Set([...regions, "us-east-1"])] : regions;

    const resources = await discoverTaggedResources(discoveryRegions, clients);
    const matches = groupDeployments(resources).filter(
      (deployment) => deployment.prefix === options.prefix,
    );

    if (matches.length === 0) {
      throw new Error(
        `No Provisionless deployment with prefix "${options.prefix}" found in ${regions.join(", ")}. Run \`provisionless list\` to see discovered deployments.`,
      );
    }

    let deployment: Deployment;
    if (options.region) {
      const matching = matches.find((candidate) => candidate.region === options.region);
      if (!matching) {
        throw new Error(
          `Prefix "${options.prefix}" was found in ${matches.map((candidate) => candidate.region).join(", ")}, not ${options.region}. Pass one of those regions with --region.`,
        );
      }
      deployment = matching;
    } else if (matches.length > 1) {
      throw new Error(
        `Prefix "${options.prefix}" exists in multiple regions: ${matches.map((candidate) => candidate.region).join(", ")}. Pass --region to choose one.`,
      );
    } else {
      deployment = matches[0] as Deployment;
    }

    let hydrated = await hydrateDeployment(deployment, clients);
    if (options.check) {
      const checks = await checkDeployment(hydrated, {
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
        ...(dependencies.timeoutMs ? { timeoutMs: dependencies.timeoutMs } : {}),
      });
      hydrated = applyChecks(hydrated, checks);
    }

    if (options.json) {
      write(`${JSON.stringify(statusJson(hydrated), null, 2)}\n`);
    } else {
      write(formatDeploymentStatus(hydrated));
    }
    return hydrated;
  } catch (error) {
    throw describeAwsError(error, `inspect deployment ${options.prefix}`);
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description(COMMAND_HELP.status.summary)
    .requiredOption("-p, --prefix <prefix>", "App prefix of the deployment")
    .option("-r, --region <region>", "Region of the deployment (discovered when omitted)")
    .option("--json", "Output the deployment as JSON", false)
    .option("--no-check", "Skip live HTTP checks of the admin and API URLs")
    .addHelpText("after", formatCommandHelp(COMMAND_HELP.status))
    .action(async (options: StatusOptions) => {
      await statusDeployment(options);
    });
}
