import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { unzipSync } from "fflate";

/** Subset of the environment that controls where artifacts are cached. */
export interface CacheEnvironment {
  PROVISIONLESS_CACHE_DIR?: string;
  XDG_CACHE_HOME?: string;
  LOCALAPPDATA?: string;
}

/** Raised when an artifact cannot be downloaded, keeping the status for actionable messages. */
export class ArtifactDownloadError extends Error {
  readonly url: string;
  readonly status?: number;

  constructor(url: string, status?: number, cause?: unknown) {
    super(
      status === undefined
        ? `Could not reach ${url}`
        : `Could not download ${url} (HTTP ${status})`,
      { cause },
    );
    this.name = "ArtifactDownloadError";
    this.url = url;
    this.status = status;
  }
}

/**
 * Resolves the directory that caches downloaded and prepared deploy artifacts. `PROVISIONLESS_CACHE_DIR`
 * wins, otherwise the conventional per-user cache directory for the platform is used.
 */
export function cacheRoot(
  env: CacheEnvironment = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  const override = env.PROVISIONLESS_CACHE_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Caches", "provisionless");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    return join(localAppData || join(home, "AppData", "Local"), "provisionless", "Cache");
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  return join(xdg || join(home, ".cache"), "provisionless");
}

/** Directory holding every cached artifact for one CLI version. */
export function versionCacheDir(root: string, version: string): string {
  return join(root, `v${version}`);
}

/** Downloads a URL into memory, folding transport failures into {@link ArtifactDownloadError}. */
export async function download(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error) {
    throw new ArtifactDownloadError(url, undefined, error);
  }
  if (!response.ok) {
    throw new ArtifactDownloadError(url, response.status);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Writes a file through a temporary sibling so an interrupted run never leaves a partial file. */
export function writeFileAtomic(path: string, contents: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

/** Removes a directory when it exists. */
export function removeDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

/**
 * Extracts a zip archive into a directory, replacing any previous contents. Paths that would escape
 * the destination are rejected.
 */
export function extractZip(archive: Uint8Array, destination: string): void {
  const root = resolve(destination);
  const entries = unzipSync(archive);

  removeDirectory(root);
  mkdirSync(root, { recursive: true });

  for (const [name, contents] of Object.entries(entries)) {
    const target = resolve(root, name);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(`Refusing to extract unsafe path "${name}" from the deploy artifact.`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

/** Reads a file that is expected to exist, with a clearer error when it does not. */
export function readRequiredFile(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw new Error(`The deploy artifact is missing ${path}. Delete the cache and retry.`, {
        cause: error,
      });
    }
    throw error;
  }
}
