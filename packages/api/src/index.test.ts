import { expect, it } from "vitest";

import { app } from "./index.ts";

it("serves the health example route", async () => {
  const response = await app.request("/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
