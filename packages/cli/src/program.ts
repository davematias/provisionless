import { createRequire } from "node:module";

import { Command } from "commander";

import { registerDeployCommand } from "./commands/deploy.ts";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name("provisionless")
    .description("Deploy Provisionless to AWS with a single command.")
    .version(version);

  registerDeployCommand(program);

  return program;
}

export async function run(argv: string[]): Promise<void> {
  await createProgram().parseAsync(argv);
}
