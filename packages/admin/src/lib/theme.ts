export const THEME_STORAGE_KEY = "provisionless-theme";

export type Theme = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyResolvedTheme(root: Element, resolved: ResolvedTheme): void {
  root.classList.toggle("dark", resolved === "dark");
}
