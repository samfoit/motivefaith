import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "motive-theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system")
    return stored;
  return "system";
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? getSystemTheme() : pref;
}

function applyToDOM(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const preference = getStoredPreference();
  const resolved = resolve(preference);

  return {
    preference,
    resolved,
    setTheme: (pref) => {
      // Validate before writing to prevent invalid values propagating via storage events
      if (pref !== "light" && pref !== "dark" && pref !== "system") return;
      localStorage.setItem(STORAGE_KEY, pref);
      const res = resolve(pref);
      applyToDOM(res);
      set({ preference: pref, resolved: res });
    },
  };
});

/**
 * Initialize theme on mount — syncs store with DOM and listens for
 * system preference changes when in "system" mode.
 * Call this once from the Providers component.
 */
export function initializeTheme() {
  const { resolved } = useThemeStore.getState();
  applyToDOM(resolved);

  // Listen for system theme changes
  if (typeof window === "undefined") return;

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    const state = useThemeStore.getState();
    if (state.preference === "system") {
      const newResolved = getSystemTheme();
      applyToDOM(newResolved);
      useThemeStore.setState({ resolved: newResolved });
    }
  };

  mediaQuery.addEventListener("change", handler);

  // Sync on storage events (cross-tab) — validate incoming value
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const raw = e.newValue;
    const pref: ThemePreference =
      raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
    const res = resolve(pref);
    applyToDOM(res);
    useThemeStore.setState({ preference: pref, resolved: res });
  });
}
