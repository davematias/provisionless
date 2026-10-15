import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import AdminShell from "./admin-shell.tsx";
import ThemeProvider from "./theme-provider.tsx";

afterEach(cleanup);

it("renders a sidebar navigation area and the main content", () => {
  render(
    <ThemeProvider>
      <AdminShell>
        <p>page body</p>
      </AdminShell>
    </ThemeProvider>,
  );

  expect(screen.getByRole("navigation", { name: "Admin" })).toBeDefined();
  expect(screen.getByRole("link", { name: "Dashboard" })).toBeDefined();
  expect(screen.getByRole("main").textContent).toContain("page body");
  expect(screen.getByRole("button", { name: "Toggle dark mode" })).toBeDefined();
});
