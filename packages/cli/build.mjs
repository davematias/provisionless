import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));

await rm(join(root, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [
    join(root, "src", "index.ts"),
    join(root, "src", "scripts", "build-release-artifacts.ts"),
    join(root, "src", "scripts", "verify-package.ts"),
  ],
  outbase: join(root, "src"),
  outdir: join(root, "dist"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  alias: {
    "@provisionless/core": join(root, "..", "core", "src", "index.ts"),
  },
  logLevel: "info",
});
