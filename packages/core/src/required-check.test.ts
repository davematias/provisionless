import { expect, it } from "vitest";

it("fails deliberately to verify that a required check blocks merge", () => {
  expect(true).toBe(false);
});
