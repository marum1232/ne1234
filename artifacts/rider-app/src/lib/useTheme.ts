import { useState, useEffect, useCallback } from "react";

const THEME_KEY = "ajkmart_dark_mode";

export function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "true"; } catch { return false; }
  });

  useEffect(() => {
    const html = document.documentElement;
    if (isDark) { html.classList.add("dark"); } else { html.classList.remove("dark"); }
  }, [isDark]);

  const toggleDark = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      try { localStorage.setItem(THEME_KEY, next ? "true" : "false"); } catch {}
      return next;
    });
  }, []);

  return { isDark, toggleDark };
}
