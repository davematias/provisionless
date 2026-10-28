import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Logo } from "./logo.tsx";

afterEach(cleanup);

it("renders the mark and the wordmark by default", () => {
  render(<Logo />);

  expect(screen.getByText("Provisionless")).toBeDefined();
  expect(screen.queryByRole("img")).toBeNull();
});

it("labels the mark when the wordmark is hidden", () => {
  render(<Logo showWordmark={false} />);

  expect(screen.getByRole("img", { name: "Provisionless" })).toBeDefined();
  expect(screen.queryByText("Provisionless")).toBeNull();
});

it("accepts classes for the wrapper and the mark", () => {
  const { container } = render(<Logo className="mb-3" markClassName="size-10" />);

  const wrapper = container.firstElementChild;
  expect(wrapper?.className).toContain("mb-3");
  expect(wrapper?.querySelector("svg")?.getAttribute("class")).toContain("size-10");
});
