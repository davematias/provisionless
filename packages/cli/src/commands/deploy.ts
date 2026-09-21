import type { Command } from "commander";

import { deploy } from "../deploy/deploy.ts";

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description("Provision the Provisionless API and admin website on AWS.")
    .option(
      "-r, --region <region>",
      "AWS region to deploy into",
      process.env.AWS_REGION ?? "us-east-1",
    )
    .option("--dry-run", "Report what would be created or updated without modifying AWS", false)
    .action(async (options: { region: string; dryRun: boolean }) => {
      await deploy({ region: options.region, dryRun: options.dryRun });
    });
}
