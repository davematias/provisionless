import { createHash } from "node:crypto";

/** Repository that publishes the deploy artifacts consumed by the CLI. */
export const RELEASE_REPOSITORY = "davematias/provisionless";

/**
 * Origin compiled into the prebuilt admin artifact. The CLI replaces it with the API URL of the
 * deployment being performed, so one admin build can serve every installation.
 */
export const API_URL_PLACEHOLDER = "https://api.provisionless.invalid";

/** Base URL of the release downloads for the publishing repository. */
export const DEFAULT_RELEASE_BASE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/download`;

/** Environment variable that points artifact resolution at another release mirror. */
export const RELEASE_BASE_URL_ENV = "PROVISIONLESS_RELEASE_BASE_URL";

export interface ReleaseAssets {
  /** Git tag of the CLI release. */
  tag: string;
  /** Archive with the admin OpenNext output. */
  admin: string;
  /** Lambda deployment package for the API. */
  api: string;
  /** SHA-256 checksums for the two archives. */
  checksums: string;
}

/** Builds the tag and asset names for a CLI version. */
export function releaseAssets(version: string): ReleaseAssets {
  const normalized = version.trim();
  if (!normalized) {
    throw new Error("Cannot resolve deploy artifacts without a CLI version.");
  }
  return {
    tag: `provisionless-v${normalized}`,
    admin: `provisionless-admin-v${normalized}.zip`,
    api: `provisionless-api-v${normalized}.zip`,
    checksums: `provisionless-v${normalized}-SHA256SUMS`,
  };
}

/** Resolves the directory that holds the assets for a version, honouring the mirror override. */
export function releaseBaseUrl(version: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[RELEASE_BASE_URL_ENV]?.trim();
  const root = override ? override.replace(/\/+$/u, "") : DEFAULT_RELEASE_BASE_URL;
  return `${root}/${releaseAssets(version).tag}`;
}

/** Joins a release directory and an asset name. */
export function assetUrl(baseUrl: string, asset: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${asset}`;
}

/** Returns the lowercase SHA-256 digest of some bytes. */
export function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Parses a `sha256sum`-style checksum file into asset name to digest entries. Lines that are not
 * well-formed checksums are ignored, so a malformed release is reported as a missing asset.
 */
export function parseChecksums(contents: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/u.exec(line);
    const digest = match?.[1];
    const name = match?.[2];
    if (digest && name) {
      entries.set(name, digest.toLowerCase());
    }
  }
  return entries;
}

/** Formats checksums in the same `sha256sum` style the CLI parses. */
export function formatChecksums(entries: Array<{ name: string; digest: string }>): string {
  return `${entries.map((entry) => `${entry.digest}  ${entry.name}`).join("\n")}\n`;
}
