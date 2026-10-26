import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { renderOpenApiDocument } from "./document.ts";

const committedPath = fileURLToPath(new URL("../../../../openapi.json", import.meta.url));

it("renders the API routes without the documentation route", async () => {
  const document = JSON.parse(await renderOpenApiDocument()) as {
    openapi: string;
    paths: Record<string, unknown>;
  };

  expect(document.openapi).toBe("3.0.3");
  expect(document.paths["/health"]).toBeDefined();
  expect(document.paths["/openapi.json"]).toBeUndefined();
});

it("matches the committed openapi.json", async () => {
  expect(await readFile(committedPath, "utf8")).toBe(await renderOpenApiDocument());
});
