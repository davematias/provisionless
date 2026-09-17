import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRepoRoot(start: string): string {
  let current = start;

  for (;;) {
    if (existsSync(join(current, "packages", "api", "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        "Could not find the Provisionless monorepo. Run this from within the repository.",
      );
    }
    current = parent;
  }
}
