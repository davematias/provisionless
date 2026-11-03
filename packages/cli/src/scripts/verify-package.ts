import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Prefix of the GitHub releases that carry the CLI. */
export const RELEASE_TAG_PREFIX = "provisionless-v";

/** Files that may appear in the published npm tarball. */
const ALLOWED_PACKAGE_FILES = new Set(["LICENSE", "README.md", "dist/index.js", "package.json"]);

/** Extracts the version from a CLI release tag, rejecting other tags. */
export function releaseVersionFromTag(tag: string): string {
  if (!tag.startsWith(RELEASE_TAG_PREFIX)) {
    throw new Error(`Expected a tag like ${RELEASE_TAG_PREFIX}X.Y.Z, got "${tag}".`);
  }
  const version = tag.slice(RELEASE_TAG_PREFIX.length);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`The release tag "${tag}" does not end in a semantic version.`);
  }
  return version;
}

/** Ensures the release tag and the package version describe the same release. */
export function verifyTagVersion(tag: string, version: string): string {
  const expected = releaseVersionFromTag(tag);
  if (expected !== version) {
    throw new Error(
      `The release tag ${tag} does not match packages/cli/package.json version ${version}. Refusing to publish.`,
    );
  }
  return expected;
}

/** Returns the problems with a proposed npm package file list, if any. */
export function packageContentErrors(files: readonly string[]): string[] {
  const errors: string[] = [];
  const unexpected = files.filter((file) => !ALLOWED_PACKAGE_FILES.has(file));
  if (unexpected.length > 0) {
    errors.push(`Unexpected files in the npm package: ${unexpected.join(", ")}.`);
  }
  if (!files.includes("dist/index.js")) {
    errors.push("The npm package is missing dist/index.js.");
  }
  if (!files.includes("package.json")) {
    errors.push("The npm package is missing package.json.");
  }
  if (!files.includes("README.md")) {
    errors.push("The npm package is missing README.md.");
  }
  return errors;
}

export function readPackageVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: string;
  };
  if (!pkg.version) {
    throw new Error(`Could not read the version from ${join(root, "package.json")}.`);
  }
  return pkg.version;
}

function packedFiles(root: string): string[] {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const [report] = JSON.parse(output) as Array<{ files?: Array<{ path?: string }> }>;
  const files = report?.files?.flatMap((file) => (file.path ? [file.path] : [])) ?? [];
  if (files.length === 0) {
    throw new Error("npm pack reported no files; run the build before verifying the package.");
  }
  return files;
}

/** Verifies the release tag, package version, and published file list. */
export function verifyPackage(options: { root: string; tag: string }): void {
  const version = readPackageVersion(options.root);
  verifyTagVersion(options.tag, version);

  const files = packedFiles(options.root);
  const errors = packageContentErrors(files);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  process.stdout.write(`provisionless@${version} contains: ${files.join(", ")}\n`);
}

function parseArguments(argv: readonly string[]): { tag: string; root: string } {
  let tag: string | undefined;
  let root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    switch (argument) {
      case "--tag":
        if (!value) {
          throw new Error("--tag requires a value.");
        }
        tag = value;
        index += 1;
        break;
      case "--root":
        if (!value) {
          throw new Error("--root requires a value.");
        }
        root = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option "${argument}".`);
    }
  }

  if (!tag) {
    throw new Error("Usage: verify-package.js --tag <provisionless-vX.Y.Z> [--root <dir>]");
  }
  return { tag, root };
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  try {
    verifyPackage(parseArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
