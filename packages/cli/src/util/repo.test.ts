import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { findRepoRoot, resolveProjectRoot } from "./repo.ts";

it("finds the checkout root from a nested directory", () => {
  const root = mkdtempSync(join(tmpdir(), "provisionless-repo-"));
  mkdirSync(join(root, "packages", "api"), { recursive: true });
  writeFileSync(join(root, "packages", "api", "package.json"), "{}");
  const nested = join(root, "packages", "cli", "src");
  mkdirSync(nested, { recursive: true });

  expect(findRepoRoot(nested)).toBe(root);
  expect(resolveProjectRoot(nested)).toEqual({ directory: root, checkout: true });
});

it("uses the current directory as the project root outside a checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "provisionless-project-"));

  expect(resolveProjectRoot(directory)).toEqual({ directory, checkout: false });
  expect(() => findRepoRoot(directory)).toThrow(/Could not find the Provisionless monorepo/);
});
