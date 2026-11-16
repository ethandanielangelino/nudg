"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const defaultContext: ThemeContextType = {
  theme: "dark",
  toggleTheme: () => {},
};

const ThemeContext = createContext<ThemeContextType>(defaultContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = localStorage.getItem("nudg-theme") as Theme | null;
      if (stored === "light" || stored === "dark") setTheme(stored);
      else if (window.matchMedia("(prefers-color-scheme: light)").matches) setTheme("light");
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useLayoutEffect(() => {
    if (!hydrated) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("nudg-theme", theme);
  }, [theme, hydrated]);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-changing");
    const update = () => flushSync(() => setTheme(nextTheme));
    const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) update();
    else if (transitionDocument.startViewTransition) transitionDocument.startViewTransition(update);
    else update();
    window.setTimeout(() => root.classList.remove("theme-changing"), 420);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  return context || defaultContext;
}
