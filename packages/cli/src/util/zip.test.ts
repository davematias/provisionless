import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unzipSync } from "fflate";
import { expect, it } from "vitest";

import { zipDirectory, zipFile } from "./zip.ts";

it("zips a single file at the archive root", () => {
  const entries = unzipSync(zipFile("index.mjs", new TextEncoder().encode("hello")));

  expect(Object.keys(entries)).toEqual(["index.mjs"]);
  expect(new TextDecoder().decode(entries["index.mjs"])).toBe("hello");
});

it("zips a directory recursively using relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "provisionless-zip-"));
  writeFileSync(join(dir, "index.mjs"), "root");
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "nested", "file.txt"), "nested");

  const entries = unzipSync(zipDirectory(dir));

  expect(Object.keys(entries).sort()).toEqual(["index.mjs", "nested/file.txt"]);
});
