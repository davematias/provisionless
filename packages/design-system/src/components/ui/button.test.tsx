import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Button } from "./button.tsx";

afterEach(cleanup);

it("renders a button with the default variant styles", () => {
  render(<Button>Save</Button>);

  const button = screen.getByRole("button", { name: "Save" });
  expect(button.className).toContain("bg-primary");
  expect(button.getAttribute("data-slot")).toBe("button");
});

it("applies variant and size and merges a custom className", () => {
  render(
    <Button variant="destructive" size="sm" className="px-10">
      Delete
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Delete" });
  expect(button.className).toContain("bg-destructive");
  expect(button.className).toContain("h-8");
  expect(button.className).toContain("px-10");
  expect(button.className).not.toContain("px-3");
});

it("renders the child element when asChild is set", () => {
  render(
    <Button asChild>
      <a href="/content">Content</a>
    </Button>,
  );

  expect(screen.getByRole("link", { name: "Content" }).getAttribute("href")).toBe("/content");
  expect(screen.queryByRole("button")).toBeNull();
});
