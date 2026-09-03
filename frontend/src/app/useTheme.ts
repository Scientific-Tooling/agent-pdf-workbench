import { useEffect, useState } from "react";

import { getThemeChoice, saveThemeChoice } from "../services/storage";

/** `system` follows the OS; the other two override it in either direction. */
export type ThemeChoice = "system" | "light" | "dark";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(() => getThemeChoice() ?? "system");

  useEffect(() => {
    // `system` leaves the attribute off, so the prefers-color-scheme media
    // query is what decides — matching how the stylesheet is written.
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
    saveThemeChoice(theme);
  }, [theme]);

  function cycleTheme(): void {
    setTheme((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
  }

  return { theme, cycleTheme };
}
