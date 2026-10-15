import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Input } from "./input.tsx";

afterEach(cleanup);

it("renders an input and forwards props", () => {
  render(<Input placeholder="Email" aria-invalid="true" />);

  const input = screen.getByPlaceholderText("Email");
  expect(input.getAttribute("data-slot")).toBe("input");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.className).toContain("border-input");
});
