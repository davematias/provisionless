import { expect, it } from "vitest";

import { createProgram } from "./program.ts";

it("names the program provisionless", () => {
  expect(createProgram().name()).toBe("provisionless");
});

it("registers the deploy command", () => {
  const program = createProgram();
  expect(program.commands.map((command) => command.name())).toContain("deploy");
});

it("exposes the --no-domains flag on deploy", () => {
  const program = createProgram();
  const deploy = program.commands.find((command) => command.name() === "deploy");

  expect(deploy?.options.map((option) => option.long)).toContain("--no-domains");
});
