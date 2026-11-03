import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Returns the version of the running CLI package, used to locate its release artifacts. */
export function cliVersion(): string {
  const pkg = require("../package.json") as { version?: string };
  if (!pkg.version) {
    throw new Error("The provisionless package has no version; reinstall it from npm.");
  }
  return pkg.version;
}
