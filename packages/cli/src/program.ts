import { createRequire } from "node:module";

import { Command } from "commander";

import { registerHelpCommand } from "./cli/help.ts";
import { CLI_NOTE } from "./cli/metadata.ts";
import { registerDeployCommand } from "./commands/deploy.ts";
import { registerUndeployCommand } from "./commands/undeploy.ts";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name("provisionless")
    .description("Deploy and undeploy Provisionless on AWS with a single command.")
    .version(version)
    .addHelpText("after", `\n${CLI_NOTE}\n`);

  registerDeployCommand(program);
  registerUndeployCommand(program);
  registerHelpCommand(program);

  return program;
}

export async function run(argv: string[]): Promise<void> {
  await createProgram().parseAsync(argv);
}
