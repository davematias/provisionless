/**
 * localStorage key for the user's theme preference.
 */
export const THEME_STORAGE_KEY = "provisionless-theme";

export type Theme = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

/**
 * Theme used when nothing valid is stored.
 */
export const DEFAULT_THEME: Theme = "system";

/**
 * Type guard for values read from storage or user input.
 */
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Resolves the `system` theme against the operating system preference.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

/**
 * Reads the stored theme, falling back to the default when storage is unavailable or holds an
 * unknown value.
 */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Toggles the `dark` class on the given root element.
 */
export function applyResolvedTheme(root: Element, resolved: ResolvedTheme): void {
  root.classList.toggle("dark", resolved === "dark");
}
