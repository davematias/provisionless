import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import ThemeProvider, { useTheme } from "./theme-provider.tsx";
import ThemeToggle from "./theme-toggle.tsx";
import { THEME_STORAGE_KEY } from "../lib/theme.ts";

beforeEach(() => {
  document.documentElement.className = "";
  window.localStorage.clear();
});

afterEach(cleanup);

it("throws when useTheme is used outside a provider", () => {
  function Consumer() {
    useTheme();
    return null;
  }

  expect(() => render(<Consumer />)).toThrow("useTheme must be used within a ThemeProvider");
});

it("applies the system preference by default", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
});

it("restores a persisted theme on mount", async () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
});

it("toggles between light and dark and persists the choice", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  const toggle = screen.getByRole("button", { name: "Toggle dark mode" });

  fireEvent.click(toggle);
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

  fireEvent.click(toggle);
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
});
