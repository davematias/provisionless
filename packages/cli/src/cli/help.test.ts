import { expect, it } from "vitest";

import { createProgram } from "../program.ts";
import { buildHelpJson, formatCommandHelp } from "./help.ts";
import { COMMAND_HELP } from "./metadata.ts";

interface HelpJson {
  usesCloudFormation: boolean;
  note: string;
  commands: { name: string; examples: string[]; prerequisites: string[]; resources: string[] }[];
}

it("exposes deploy and undeploy as machine-readable help", () => {
  const json = buildHelpJson(createProgram()) as HelpJson;
  const names = json.commands.map((command) => command.name);

  expect(json.usesCloudFormation).toBe(false);
  expect(json.note).toContain("CloudFormation");
  expect(names).toContain("deploy");
  expect(names).toContain("undeploy");

  const deploy = json.commands.find((command) => command.name === "deploy");
  expect(deploy?.examples.length).toBeGreaterThan(0);
  expect(deploy?.resources.length).toBeGreaterThan(0);
});

it("can build help for a single command", () => {
  const json = buildHelpJson(createProgram(), "undeploy") as HelpJson;

  expect(json.commands.map((command) => command.name)).toEqual(["undeploy"]);
});

it("formats command help with examples, prerequisites, and resources", () => {
  const text = formatCommandHelp(COMMAND_HELP.undeploy);

  expect(text).toContain("Examples:");
  expect(text).toContain("Prerequisites:");
  expect(text).toContain("Manages:");
});
