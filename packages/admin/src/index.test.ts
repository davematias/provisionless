import { expect, it } from "vitest";

import { getPackageName } from "./index.js";

it("exposes the admin package name", () => {
  expect(getPackageName()).toBe("@provisionless/admin");
});
