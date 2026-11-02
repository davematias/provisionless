import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";
import { expect, it } from "vitest";

import {
  cacheRoot,
  extractZip,
  readRequiredFile,
  removeDirectory,
  versionCacheDir,
  writeFileAtomic,
} from "./cache.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "provisionless-cache-"));
}

it("uses PROVISIONLESS_CACHE_DIR when it is set", () => {
  expect(
    cacheRoot({ PROVISIONLESS_CACHE_DIR: "/tmp/provisionless-cache" }, "linux", "/home/x"),
  ).toBe("/tmp/provisionless-cache");
});

it("uses the macOS cache directory by default", () => {
  expect(cacheRoot({}, "darwin", "/Users/example")).toBe(
    "/Users/example/Library/Caches/provisionless",
  );
});

it("uses the XDG cache directory on Linux", () => {
  expect(cacheRoot({ XDG_CACHE_HOME: "/home/example/.cache" }, "linux", "/home/example")).toBe(
    "/home/example/.cache/provisionless",
  );
  expect(cacheRoot({}, "linux", "/home/example")).toBe("/home/example/.cache/provisionless");
});

it("uses the local application data directory on Windows", () => {
  expect(
    cacheRoot(
      { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local" },
      "win32",
      "C:\\Users\\example",
    ),
  ).toBe(join("C:\\Users\\example\\AppData\\Local", "provisionless", "Cache"));
});

it("namespaces cached files by version", () => {
  expect(versionCacheDir("/cache/provisionless", "1.2.3")).toBe("/cache/provisionless/v1.2.3");
});

it("writes files atomically and creates parent directories", () => {
  const directory = tempDir();
  const path = join(directory, "nested", "file.txt");

  writeFileAtomic(path, "contents");

  expect(readFileSync(path, "utf8")).toBe("contents");
});

it("extracts zip archives and removes stale files first", () => {
  const directory = tempDir();
  removeDirectory(directory);
  writeFileAtomic(join(directory, "stale.txt"), "old");

  const archive = zipSync({
    "open-next.output.json": new TextEncoder().encode("{}"),
    "server-functions/default/index.mjs": new TextEncoder().encode("handler"),
  });
  extractZip(archive, directory);

  expect(readFileSync(join(directory, "open-next.output.json"), "utf8")).toBe("{}");
  expect(readFileSync(join(directory, "server-functions", "default", "index.mjs"), "utf8")).toBe(
    "handler",
  );
  expect(() => readFileSync(join(directory, "stale.txt"))).toThrow();
});

it("refuses archive paths that escape the destination", () => {
  const directory = tempDir();
  const archive = zipSync({ "../escape.txt": new Uint8Array([1]) });

  expect(() => extractZip(archive, directory)).toThrow(/unsafe path/);
});

it("reports a missing required artifact file", () => {
  expect(() => readRequiredFile(join(tempDir(), "missing.zip"))).toThrow(/Delete the cache/);
});
