import type { Command } from "commander";

import { CLI_NOTE, commandHelp, type CommandHelp } from "./metadata.ts";

export function formatCommandHelp(help: CommandHelp): string {
  const lines = ["", "Examples:"];
  for (const example of help.examples) {
    lines.push(`  $ ${example}`);
  }
  lines.push("", "Prerequisites:");
  for (const prerequisite of help.prerequisites) {
    lines.push(`  - ${prerequisite}`);
  }
  lines.push("", "Manages:");
  for (const resource of help.resources) {
    lines.push(`  - ${resource}`);
  }
  return lines.join("\n");
}

interface CommandJson {
  name: string;
  description: string;
  options: { flags: string; description: string }[];
  examples: string[];
  prerequisites: string[];
  resources: string[];
}

export function buildHelpJson(program: Command, commandName?: string): object {
  const commands = program.commands
    .filter((command) => command.name() !== "help")
    .filter((command) => commandName === undefined || command.name() === commandName);

  return {
    name: program.name(),
    description: program.description(),
    version: program.version(),
    usesCloudFormation: false,
    note: CLI_NOTE,
    commands: commands.map((command): CommandJson => {
      const help = commandHelp(command.name()) ?? {
        summary: command.description(),
        examples: [],
        prerequisites: [],
        resources: [],
      };
      return {
        name: command.name(),
        description: help.summary,
        options: command.options.map((option) => ({
          flags: option.flags,
          description: option.description,
        })),
        examples: help.examples,
        prerequisites: help.prerequisites,
        resources: help.resources,
      };
    }),
  };
}

export function registerHelpCommand(program: Command): void {
  program.addHelpCommand(false);
  program
    .command("help [command]")
    .description("Show help for the CLI or a specific command")
    .option("--json", "Output help as JSON for tooling and agents", false)
    .action((commandName: string | undefined, options: { json: boolean }) => {
      if (options.json) {
        process.stdout.write(`${JSON.stringify(buildHelpJson(program, commandName), null, 2)}\n`);
        return;
      }
      const target = commandName ? program.commands.find((c) => c.name() === commandName) : program;
      if (!target) {
        program.error(`Unknown command "${commandName}".`);
        return;
      }
      target.outputHelp();
    });
}
