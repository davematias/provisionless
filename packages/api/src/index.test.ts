import { expect, it } from "vitest";

import { getPackageName } from "./index.js";

it("exposes the api package name", () => {
  expect(getPackageName()).toBe("@provisionless/api");
});
