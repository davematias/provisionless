import { expect, it } from "vitest";

import { cn } from "./utils.ts";

it("joins class names and drops falsy values", () => {
  expect(cn("flex", undefined, false, "items-center")).toBe("flex items-center");
});

it("resolves conflicting Tailwind utilities in favor of the last one", () => {
  expect(cn("px-2", "px-4")).toBe("px-4");
  expect(cn("text-sm font-medium", "text-lg")).toBe("font-medium text-lg");
});
