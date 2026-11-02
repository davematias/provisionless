import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** A directory the CLI treats as the project, and whether it is a Provisionless checkout. */
export interface ProjectRoot {
  directory: string;
  checkout: boolean;
}

function findRepoCheckout(start: string): string | undefined {
  let current = start;

  for (;;) {
    if (existsSync(join(current, "packages", "api", "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/** Finds the Provisionless checkout containing `start`, throwing when there is none. */
export function findRepoRoot(start: string): string {
  const root = findRepoCheckout(start);
  if (!root) {
    throw new Error(
      "Could not find the Provisionless monorepo. Run this from within the repository.",
    );
  }
  return root;
}

/**
 * Resolves the project root for a command. Inside a checkout the repository root is used, keeping
 * the config next to the sources; elsewhere the current directory becomes the project root so a
 * published CLI can deploy from any folder.
 */
export function resolveProjectRoot(start: string): ProjectRoot {
  const root = findRepoCheckout(start);
  return root ? { directory: root, checkout: true } : { directory: start, checkout: false };
}
