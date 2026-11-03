import { expect, it } from "vitest";

import { packageContentErrors, releaseVersionFromTag, verifyTagVersion } from "./verify-package.ts";

it("extracts the version from a CLI release tag", () => {
  expect(releaseVersionFromTag("provisionless-v0.1.0")).toBe("0.1.0");
  expect(releaseVersionFromTag("provisionless-v1.2.3-beta.1")).toBe("1.2.3-beta.1");
});

it("rejects tags that are not CLI releases", () => {
  expect(() => releaseVersionFromTag("provisionless-monorepo-v0.2.0")).toThrow(
    /Expected a tag like provisionless-vX\.Y\.Z/,
  );
  expect(() => releaseVersionFromTag("provisionless-vnext")).toThrow(/semantic version/);
});

it("fails when the tag and package version differ", () => {
  expect(verifyTagVersion("provisionless-v0.2.0", "0.2.0")).toBe("0.2.0");
  expect(() => verifyTagVersion("provisionless-v0.2.0", "0.1.0")).toThrow(
    /does not match packages\/cli\/package\.json version 0\.1\.0/,
  );
});

it("accepts a package with only runtime files", () => {
  expect(packageContentErrors(["README.md", "package.json", "dist/index.js"])).toEqual([]);
});

it("reports unexpected files in the package", () => {
  expect(
    packageContentErrors(["README.md", "package.json", "dist/index.js", "src/index.ts"]),
  ).toEqual(["Unexpected files in the npm package: src/index.ts."]);
});

it("reports missing runtime files", () => {
  expect(packageContentErrors(["package.json", "README.md"])).toEqual([
    "The npm package is missing dist/index.js.",
  ]);
  expect(packageContentErrors(["dist/index.js", "README.md"])).toEqual([
    "The npm package is missing package.json.",
  ]);
});
