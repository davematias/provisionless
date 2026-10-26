"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "./theme-provider.tsx";
import { Button } from "./ui/button.tsx";

/**
 * Icon button that switches between the light and dark themes.
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Moon /> : <Sun />}
    </Button>
  );
}
