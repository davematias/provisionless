import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "esbuild";

import { zipFile } from "../util/zip.ts";

/** Bundles the API Lambda from the source checkout into a deployment zip. */
export async function bundleApi(repoRoot: string): Promise<Buffer> {
  const outfile = join(mkdtempSync(join(tmpdir(), "provisionless-api-")), "index.mjs");
  await build({
    entryPoints: [join(repoRoot, "packages", "api", "src", "lambda.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    logLevel: "silent",
    alias: {
      "@provisionless/core": join(repoRoot, "packages", "core", "src", "index.ts"),
    },
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  return zipFile("index.mjs", new Uint8Array(readFileSync(outfile)));
}
