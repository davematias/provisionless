import { expect, it } from "vitest";

import {
  applyResolvedTheme,
  DEFAULT_THEME,
  isTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./theme.ts";

it("guards against unknown theme values", () => {
  expect(isTheme("dark")).toBe(true);
  expect(isTheme("system")).toBe(true);
  expect(isTheme("sunrise")).toBe(false);
  expect(isTheme(undefined)).toBe(false);
});

it("resolves the system theme against the media preference", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

it("reads a stored theme and falls back to the default", () => {
  const storage = { getItem: (key: string) => (key === THEME_STORAGE_KEY ? "dark" : null) };
  expect(readStoredTheme(storage)).toBe("dark");
  expect(readStoredTheme({ getItem: () => "bogus" })).toBe(DEFAULT_THEME);
  expect(readStoredTheme(undefined)).toBe(DEFAULT_THEME);
});

it("falls back to the default when storage throws", () => {
  const storage = {
    getItem: () => {
      throw new Error("denied");
    },
  };
  expect(readStoredTheme(storage)).toBe(DEFAULT_THEME);
});

it("toggles the dark class on the given element", () => {
  const root = document.createElement("div");

  applyResolvedTheme(root, "dark");
  expect(root.classList.contains("dark")).toBe(true);

  applyResolvedTheme(root, "light");
  expect(root.classList.contains("dark")).toBe(false);
});
