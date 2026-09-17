import { expect, it } from "vitest";

import { getPackageName } from "./index.ts";

it("exposes the admin package name", () => {
  expect(getPackageName()).toBe("@provisionless/admin");
});
