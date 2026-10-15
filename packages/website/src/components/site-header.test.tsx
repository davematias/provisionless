import { ThemeProvider } from "@provisionless/design-system";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SiteHeader } from "./site-header.tsx";
import { GITHUB_URL } from "../lib/site.ts";

afterEach(cleanup);

it("renders the site name, GitHub link, and theme toggle", () => {
  render(
    <ThemeProvider>
      <SiteHeader />
    </ThemeProvider>,
  );

  expect(screen.getByRole("link", { name: "Provisionless" }).getAttribute("href")).toBe("/");
  expect(screen.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(GITHUB_URL);
  expect(screen.getByRole("button", { name: "Toggle dark mode" })).toBeDefined();
});
