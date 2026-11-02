import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { buildReleaseArtifacts } from "./build-release-artifacts.ts";

function repoWithVersion(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "provisionless-release-"));
  mkdirSync(join(root, "packages", "cli"), { recursive: true });
  writeFileSync(join(root, "packages", "cli", "package.json"), JSON.stringify({ version }));
  return root;
}

it("refuses to build artifacts when the release tag and CLI version differ", async () => {
  await expect(
    buildReleaseArtifacts({
      version: "1.2.3",
      repoRoot: repoWithVersion("0.0.0"),
      outDir: mkdtempSync(join(tmpdir(), "provisionless-release-out-")),
    }),
  ).rejects.toThrow(/packages\/cli\/package\.json is 0\.0\.0/);
});

it("refuses to build artifacts without a version", async () => {
  await expect(
    buildReleaseArtifacts({
      version: " ",
      repoRoot: repoWithVersion("1.2.3"),
      outDir: mkdtempSync(join(tmpdir(), "provisionless-release-out-")),
    }),
  ).rejects.toThrow(/without a version/);
});
