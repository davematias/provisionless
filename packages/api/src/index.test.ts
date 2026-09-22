import { expect, it } from "vitest";

import { createApp } from "./index.ts";

it("serves the health example route", async () => {
  const app = createApp({
    users: { getUser: async () => undefined },
    jwtSecret: "test-secret",
    secureCookies: false,
  });

  const response = await app.request("/health");

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
