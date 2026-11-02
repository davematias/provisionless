import { expect, it } from "vitest";

import {
  assetUrl,
  DEFAULT_RELEASE_BASE_URL,
  formatChecksums,
  parseChecksums,
  releaseAssets,
  releaseBaseUrl,
  sha256,
} from "./release.ts";

it("derives the release tag and asset names from the CLI version", () => {
  expect(releaseAssets("1.2.3")).toEqual({
    tag: "provisionless-v1.2.3",
    admin: "provisionless-admin-v1.2.3.zip",
    api: "provisionless-api-v1.2.3.zip",
    checksums: "provisionless-v1.2.3-SHA256SUMS",
  });
});

it("resolves the public release URL for a version", () => {
  expect(releaseBaseUrl("1.2.3", {})).toBe(`${DEFAULT_RELEASE_BASE_URL}/provisionless-v1.2.3`);
  expect(assetUrl(releaseBaseUrl("1.2.3", {}), "provisionless-api-v1.2.3.zip")).toBe(
    `${DEFAULT_RELEASE_BASE_URL}/provisionless-v1.2.3/provisionless-api-v1.2.3.zip`,
  );
});

it("lets a mirror override the release URL and trims trailing slashes", () => {
  const env = { PROVISIONLESS_RELEASE_BASE_URL: "https://mirror.example.test/releases/" };

  expect(releaseBaseUrl("1.2.3", env)).toBe(
    "https://mirror.example.test/releases/provisionless-v1.2.3",
  );
});

it("rejects an empty version", () => {
  expect(() => releaseAssets("  ")).toThrow(/without a CLI version/);
});

it("formats and parses checksum files round trip", () => {
  const contents = formatChecksums([
    { name: "provisionless-admin-v1.2.3.zip", digest: "a".repeat(64) },
    { name: "provisionless-api-v1.2.3.zip", digest: "b".repeat(64) },
  ]);

  expect(contents).toBe(
    `${"a".repeat(64)}  provisionless-admin-v1.2.3.zip\n${"b".repeat(64)}  provisionless-api-v1.2.3.zip\n`,
  );
  expect(parseChecksums(contents)).toEqual(
    new Map([
      ["provisionless-admin-v1.2.3.zip", "a".repeat(64)],
      ["provisionless-api-v1.2.3.zip", "b".repeat(64)],
    ]),
  );
});

it("ignores malformed checksum lines and accepts binary-mode markers", () => {
  const contents = ["not a checksum", `${"c".repeat(64)} *provisionless-api-v1.2.3.zip`, ""].join(
    "\n",
  );

  expect(parseChecksums(contents)).toEqual(
    new Map([["provisionless-api-v1.2.3.zip", "c".repeat(64)]]),
  );
});

it("computes lowercase SHA-256 digests", () => {
  expect(sha256(Buffer.from("provisionless"))).toBe(
    "8090d80909cf3f57c5b477ea0d8925f377b8f0a569efa7fe2703412a4fd92e26",
  );
});
