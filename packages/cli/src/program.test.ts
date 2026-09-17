import { expect, it } from "vitest";

import { createProgram } from "./program.ts";

it("names the program provisionless", () => {
  expect(createProgram().name()).toBe("provisionless");
});

it("registers the deploy command", () => {
  const program = createProgram();
  expect(program.commands.map((command) => command.name())).toContain("deploy");
});
