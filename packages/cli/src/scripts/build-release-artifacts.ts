import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { bundleApi } from "../artifacts/api-bundle.ts";
import {
  API_URL_PLACEHOLDER,
  formatChecksums,
  releaseAssets,
  sha256,
} from "../artifacts/release.ts";
import { zipDirectory } from "../util/zip.ts";

export interface BuildArtifactsOptions {
  version: string;
  repoRoot: string;
  outDir: string;
}

/**
 * Builds the deploy artifacts for a CLI version and writes them next to a checksum file. The admin
 * output is built with the API placeholder so the CLI can point it at any deployment.
 */
export async function buildReleaseArtifacts(options: BuildArtifactsOptions): Promise<string[]> {
  const version = options.version.trim();
  if (!version) {
    throw new Error("Refusing to build deploy artifacts without a version.");
  }

  const repoRoot = resolve(options.repoRoot);
  const cliPackagePath = join(repoRoot, "packages", "cli", "package.json");
  const cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf8")) as { version?: string };
  if (cliPackage.version !== version) {
    throw new Error(
      `Refusing to build deploy artifacts for ${version}: packages/cli/package.json is ${cliPackage.version}. The release tag and the published CLI version must match.`,
    );
  }

  const assets = releaseAssets(version);
  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });

  const openNextDir = join(repoRoot, "packages", "admin", ".open-next");
  rmSync(openNextDir, { recursive: true, force: true });

  execFileSync("npm", ["run", "build:lambda", "--workspace=@provisionless/admin"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_API_URL: API_URL_PLACEHOLDER },
  });

  if (!existsSync(join(openNextDir, "open-next.output.json"))) {
    throw new Error(
      `The admin build did not produce ${join(openNextDir, "open-next.output.json")}.`,
    );
  }

  const adminArchive = zipDirectory(openNextDir);
  const apiArchive = await bundleApi(repoRoot);

  const adminPath = join(outDir, assets.admin);
  const apiPath = join(outDir, assets.api);
  const checksumsPath = join(outDir, assets.checksums);
  writeFileSync(adminPath, adminArchive);
  writeFileSync(apiPath, apiArchive);
  writeFileSync(
    checksumsPath,
    formatChecksums([
      { name: assets.admin, digest: sha256(adminArchive) },
      { name: assets.api, digest: sha256(apiArchive) },
    ]),
  );

  return [adminPath, apiPath, checksumsPath];
}

function parseArguments(argv: readonly string[]): BuildArtifactsOptions {
  let version: string | undefined;
  let repoRoot = process.cwd();
  let outDir = join(process.cwd(), "dist", "release");

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    switch (argument) {
      case "--version":
        if (!value) {
          throw new Error("--version requires a value.");
        }
        version = value;
        index += 1;
        break;
      case "--repo":
        if (!value) {
          throw new Error("--repo requires a value.");
        }
        repoRoot = value;
        index += 1;
        break;
      case "--out":
        if (!value) {
          throw new Error("--out requires a value.");
        }
        outDir = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option "${argument}".`);
    }
  }

  if (!version) {
    throw new Error(
      "Usage: build-release-artifacts.js --version <version> [--repo <dir>] [--out <dir>]",
    );
  }

  return { version, repoRoot, outDir };
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  buildReleaseArtifacts(parseArguments(process.argv.slice(2)))
    .then((paths) => {
      process.stdout.write(
        `Wrote deploy artifacts:\n${paths.map((path) => `  ${path}`).join("\n")}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
