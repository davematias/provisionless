import type { Command } from "commander";

import { formatCommandHelp } from "../cli/help.ts";
import { COMMAND_HELP } from "../cli/metadata.ts";
import { deploy } from "../deploy/deploy.ts";

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description(COMMAND_HELP.deploy?.summary ?? "Provision the Provisionless stack on AWS.")
    .option("-r, --region <region>", "AWS region (prompted when omitted)")
    .option("-p, --prefix <prefix>", "App prefix used to name resources (prompted when omitted)")
    .option("--media-bucket <name>", "Media bucket name (prompted when omitted)")
    .option("--admin-domain <domain>", "Custom domain for the admin site (prompted when omitted)")
    .option("--api-domain <domain>", "Custom domain for the API (prompted when omitted)")
    .option("--hosted-zone <id-or-name>", "Route 53 hosted zone for automatic DNS records")
    .option("--test-user-username <username>", "Test user username (prompted when omitted)")
    .option("--test-user-password <password>", "Test user password (prompted when omitted)")
    .option("--dry-run", "Report what would be created or updated without modifying AWS", false)
    .addHelpText("after", formatCommandHelp(COMMAND_HELP.deploy))
    .action(
      async (options: {
        region: string;
        prefix?: string;
        mediaBucket?: string;
        adminDomain?: string;
        apiDomain?: string;
        hostedZone?: string;
        testUserUsername?: string;
        testUserPassword?: string;
        dryRun: boolean;
      }) => {
        await deploy({
          region: options.region,
          prefix: options.prefix,
          mediaBucket: options.mediaBucket,
          adminDomain: options.adminDomain,
          apiDomain: options.apiDomain,
          hostedZone: options.hostedZone,
          testUserUsername: options.testUserUsername,
          testUserPassword: options.testUserPassword,
          dryRun: options.dryRun,
        });
      },
    );
}
