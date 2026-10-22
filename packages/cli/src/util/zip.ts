import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { zipSync } from "fflate";

function collectFiles(dir: string): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const key = relative(dir, full).split(sep).join("/");
        entries[key] = new Uint8Array(readFileSync(full));
      }
    }
  };

  walk(dir);
  return entries;
}

export function zipDirectory(dir: string): Buffer {
  return Buffer.from(zipSync(collectFiles(dir), { level: 6 }));
}

export function zipFile(name: string, contents: Uint8Array): Buffer {
  return Buffer.from(zipSync({ [name]: contents }, { level: 6 }));
}
