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
    .option("-p, --prefix <prefix>", "App prefix used to name resources (prompted when omitted)")
    .option("--test-user-username <username>", "Test user username (prompted when omitted)")
    .option("--test-user-password <password>", "Test user password (prompted when omitted)")
    .option("--dry-run", "Report what would be created or updated without modifying AWS", false)
    .action(
      async (options: {
        region: string;
        prefix?: string;
        testUserUsername?: string;
        testUserPassword?: string;
        dryRun: boolean;
      }) => {
        await deploy({
          region: options.region,
          prefix: options.prefix,
          testUserUsername: options.testUserUsername,
          testUserPassword: options.testUserPassword,
          dryRun: options.dryRun,
        });
      },
    );
}
