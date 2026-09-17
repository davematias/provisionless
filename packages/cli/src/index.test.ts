import { expect, it } from "vitest";

import { getPackageName } from "./index.ts";

it("exposes the cli package name", () => {
  expect(getPackageName()).toBe("@provisionless/cli");
});
