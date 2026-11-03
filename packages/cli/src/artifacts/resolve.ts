import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ArtifactDownloadError,
  cacheRoot,
  download,
  extractZip,
  readRequiredFile,
  versionCacheDir,
  writeFileAtomic,
} from "./cache.ts";
import {
  API_URL_PLACEHOLDER,
  assetUrl,
  parseChecksums,
  releaseAssets,
  releaseBaseUrl,
  sha256,
} from "./release.ts";
import type { Logger } from "../util/log.ts";

const MARKER_FILE = ".provisionless-artifact.json";
const TEXT_ARTIFACT = /\.(?:cjs|css|html|js|json|map|mjs|rsc|txt)$/u;

/** Thrown when a downloaded archive does not match its published checksum. */
export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}

export interface ArtifactOptions {
  version: string;
  log: Logger;
  env?: NodeJS.ProcessEnv;
}

export interface AdminArtifactOptions extends ArtifactOptions {
  /** API URL the admin artifact should call once deployed. */
  apiUrl: string;
}

interface ArchiveRequest extends ArtifactOptions {
  asset: string;
  directory: string;
}

function missingChecksumMessage(version: string, asset: string, checksumsAsset: string): string {
  return `The ${checksumsAsset} asset for Provisionless ${version} does not list ${asset}. The provisionless-v${version} release is incomplete; rebuild it with the release artifacts workflow.`;
}

function downloadFailureMessage(
  version: string,
  asset: string,
  url: string,
  status: number | undefined,
): string {
  const detail = status === undefined ? "" : ` (HTTP ${status})`;
  return `Could not download ${asset} for Provisionless ${version} from ${url}${detail}. The provisionless-v${version} GitHub release must include ${asset}. Install the matching CLI with \`npm install -g provisionless@${version}\`, or run the command from a Provisionless source checkout.`;
}

function integrityMessage(
  version: string,
  asset: string,
  url: string,
  expected: string,
  actual: string,
  path: string,
): string {
  return `Integrity check failed for ${asset} (Provisionless ${version}): expected SHA-256 ${expected}, got ${actual} from ${url}. Delete ${path} and retry; if it persists, the release asset is corrupt.`;
}

async function downloadAsset(version: string, asset: string, url: string): Promise<Uint8Array> {
  try {
    return await download(url);
  } catch (error) {
    if (error instanceof ArtifactDownloadError) {
      throw new Error(downloadFailureMessage(version, asset, url, error.status), {
        cause: error,
      });
    }
    throw error;
  }
}

async function loadChecksums(
  request: ArchiveRequest,
  refresh: boolean,
): Promise<Map<string, string>> {
  const assets = releaseAssets(request.version);
  const path = join(request.directory, assets.checksums);
  if (!refresh && existsSync(path)) {
    return parseChecksums(readFileSync(path, "utf8"));
  }

  const url = assetUrl(releaseBaseUrl(request.version, request.env), assets.checksums);
  request.log(`downloading ${assets.checksums}`);
  const contents = await downloadAsset(request.version, assets.checksums, url);
  writeFileAtomic(path, contents);
  return parseChecksums(Buffer.from(contents).toString("utf8"));
}

async function resolveArchive(request: ArchiveRequest): Promise<{ path: string; digest: string }> {
  const assets = releaseAssets(request.version);
  const baseUrl = releaseBaseUrl(request.version, request.env);
  const url = assetUrl(baseUrl, request.asset);
  const path = join(request.directory, request.asset);

  let checksums = await loadChecksums(request, false);
  let expected = checksums.get(request.asset);
  if (!expected) {
    checksums = await loadChecksums(request, true);
    expected = checksums.get(request.asset);
  }
  if (!expected) {
    throw new Error(missingChecksumMessage(request.version, request.asset, assets.checksums));
  }

  if (existsSync(path) && sha256(readFileSync(path)) === expected) {
    return { path, digest: expected };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    request.log(`downloading ${request.asset} for Provisionless ${request.version}`);
    const contents = await downloadAsset(request.version, request.asset, url);
    const actual = sha256(contents);

    if (actual === expected) {
      writeFileAtomic(path, contents);
      return { path, digest: expected };
    }

    if (attempt === 0) {
      request.log(`integrity check failed for ${request.asset}; refreshing ${assets.checksums}`);
      checksums = await loadChecksums(request, true);
      expected = checksums.get(request.asset);
      if (!expected) {
        throw new Error(missingChecksumMessage(request.version, request.asset, assets.checksums));
      }
      continue;
    }

    throw new ArtifactIntegrityError(
      integrityMessage(request.version, request.asset, url, expected, actual, path),
    );
  }

  throw new ArtifactIntegrityError(
    `Integrity check failed for ${request.asset} (Provisionless ${request.version}).`,
  );
}

/**
 * Replaces every occurrence of `from` with `to` in text files under a directory and returns the
 * number of replacements. Binary files are left untouched.
 */
export function rewriteApiUrl(directory: string, from: string, to: string): number {
  let replacements = 0;

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !TEXT_ARTIFACT.test(entry.name)) {
        continue;
      }
      const contents = readFileSync(full, "utf8");
      if (!contents.includes(from)) {
        continue;
      }
      replacements += contents.split(from).length - 1;
      writeFileSync(full, contents.split(from).join(to), "utf8");
    }
  };

  walk(directory);
  return replacements;
}

/**
 * Downloads, verifies, and prepares the admin deploy artifact for an API URL. The prepared output is
 * cached per API URL so later deploys do not rebuild anything.
 */
export async function resolveAdminArtifact(options: AdminArtifactOptions): Promise<string> {
  const env = options.env ?? process.env;
  const assets = releaseAssets(options.version);
  const directory = versionCacheDir(cacheRoot(env), options.version);
  const { digest } = await resolveArchive({
    version: options.version,
    asset: assets.admin,
    directory,
    log: options.log,
    env,
  });

  const apiKey = sha256(Buffer.from(options.apiUrl, "utf8")).slice(0, 16);
  const target = join(directory, `admin-${apiKey}`);
  const markerPath = join(target, MARKER_FILE);

  if (existsSync(join(target, "open-next.output.json")) && existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
        version?: string;
        apiUrl?: string;
        archiveSha256?: string;
      };
      if (
        marker.version === options.version &&
        marker.apiUrl === options.apiUrl &&
        marker.archiveSha256 === digest
      ) {
        options.log(`using cached admin deploy artifacts for ${options.apiUrl}`);
        return target;
      }
    } catch {
      options.log("ignoring an unreadable admin artifact cache marker");
    }
  }

  options.log(`preparing admin deploy artifacts for ${options.apiUrl}`);
  extractZip(readRequiredFile(join(directory, assets.admin)), target);

  const replacements = rewriteApiUrl(target, API_URL_PLACEHOLDER, options.apiUrl);
  if (replacements === 0) {
    throw new Error(
      `The admin artifact for Provisionless ${options.version} does not contain the deploy-time API placeholder. The release asset was probably built incorrectly; rebuild it with the release artifacts workflow.`,
    );
  }

  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        version: options.version,
        apiUrl: options.apiUrl,
        archiveSha256: digest,
        replacements,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return target;
}

/** Downloads and verifies the API Lambda deployment package for the running CLI version. */
export async function resolveApiArtifact(options: ArtifactOptions): Promise<Buffer> {
  const env = options.env ?? process.env;
  const assets = releaseAssets(options.version);
  const directory = versionCacheDir(cacheRoot(env), options.version);
  const { path } = await resolveArchive({
    version: options.version,
    asset: assets.api,
    directory,
    log: options.log,
    env,
  });
  return readRequiredFile(path);
}
