import type { Command } from "commander";

import { formatCommandHelp } from "../cli/help.ts";
import { COMMAND_HELP } from "../cli/metadata.ts";
import { undeploy } from "../deploy/undeploy.ts";

export function registerUndeployCommand(program: Command): void {
  program
    .command("undeploy")
    .description(COMMAND_HELP.undeploy.summary)
    .option("-r, --region <region>", "AWS region (prompted when omitted)")
    .option("-p, --prefix <prefix>", "App prefix (read from .provisionless when omitted)")
    .option("--keep-data", "Keep S3 objects and DynamoDB tables")
    .option("--no-keep-data", "Delete S3 objects and DynamoDB tables too")
    .option("-y, --yes", "Do not prompt for confirmation", false)
    .option("--dry-run", "Report what would be deleted without changing AWS", false)
    .addHelpText("after", formatCommandHelp(COMMAND_HELP.undeploy))
    .action(
      async (options: {
        region?: string;
        prefix?: string;
        keepData?: boolean;
        yes: boolean;
        dryRun: boolean;
      }) => {
        await undeploy({
          region: options.region,
          prefix: options.prefix,
          keepData: options.keepData,
          yes: options.yes,
          dryRun: options.dryRun,
        });
      },
    );
}
