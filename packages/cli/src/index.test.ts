import { expect, it } from "vitest";

import { getPackageName } from "./index.js";

it("exposes the cli package name", () => {
  expect(getPackageName()).toBe("@provisionless/cli");
});
