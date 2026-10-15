import { create } from "zustand";
import { ALL_VARS, PINNED_HOUR, hourOf, palette } from "@/lib/lamplight/palette";

/**
 * "day" is Lamplight's default: the colors and the sky follow the local hour.
 * Light and Dark pin a clear midday or a lamplit night; System picks one of
 * those two from the OS setting.
 */
export type ThemePreference = "day" | "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "motive-theme";

/**
 * Debug override for the hour, as a fraction (21.5 is 9:30 PM). Set it in
 * DevTools to see any time of day without waiting for it. The init script
 * reads the same key, so a reload shows that hour from the first paint.
 */
export const SKY_HOUR_KEY = "motive-sky-hour";

const PINNED_THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#D3E5F3",
  dark: "#12151F",
};

function isPreference(v: unknown): v is ThemePreference {
  return v === "day" || v === "light" || v === "dark" || v === "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "day";
  const stored = localStorage.getItem(STORAGE_KEY);
  return isPreference(stored) ? stored : "day";
}

function currentHour(): number {
  if (typeof window !== "undefined") {
    try {
      const override = parseFloat(localStorage.getItem(SKY_HOUR_KEY) ?? "");
      if (override >= 0 && override < 24) return override;
    } catch {
      // Storage blocked: fall through to the clock.
    }
  }
  return hourOf(new Date());
}

interface Applied {
  resolved: ResolvedTheme;
  /** The hour the sky shows: the clock in "day" mode, else the pin's hour. */
  hour: number;
}

function resolve(pref: ThemePreference): Applied {
  if (pref === "day") {
    const hour = currentHour();
    return { resolved: palette(hour).light ? "light" : "dark", hour };
  }
  const resolved = pref === "system" ? getSystemTheme() : pref;
  return { resolved, hour: PINNED_HOUR[resolved] };
}

function setThemeColor(color: string) {
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", color));
}

function applyToDOM(pref: ThemePreference): Applied {
  const applied = resolve(pref);
  if (typeof document === "undefined") return applied;
  const root = document.documentElement;

  if (pref === "day") {
    // The hour's blend, written inline so it wins over the pinned blocks in
    // tokens.css. data-theme still marks the family, so the existing
    // [data-theme="dark"] rules (habit tint, rain blue) keep applying.
    const { vars } = palette(applied.hour);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.style.background = vars["--color-bg-primary"];
    setThemeColor(vars["--color-header"]);
  } else {
    for (const name of ALL_VARS) root.style.removeProperty(name);
    root.style.background = "";
    setThemeColor(PINNED_THEME_COLOR[applied.resolved]);
  }

  if (applied.resolved === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
  return applied;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  hour: number;
  setTheme: (pref: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const preference = getStoredPreference();

  return {
    preference,
    ...resolve(preference),
    setTheme: (pref) => {
      // Validate before writing to prevent invalid values propagating via storage events
      if (!isPreference(pref)) return;
      localStorage.setItem(STORAGE_KEY, pref);
      set({ preference: pref, ...applyToDOM(pref) });
    },
  };
});

function refresh() {
  const { preference } = useThemeStore.getState();
  useThemeStore.setState(applyToDOM(preference));
}

/**
 * Initialize theme on mount — syncs store with DOM, follows the clock in
 * "day" mode and the OS in "system" mode.
 * Call this once from the Providers component.
 */
export function initializeTheme() {
  refresh();

  if (typeof window === "undefined") return;

  // The hour moves the palette a little each minute. A tab in the background
  // skips its ticks, so coming back to it catches up at once.
  window.setInterval(() => {
    if (useThemeStore.getState().preference === "day") refresh();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", () => {
    if (useThemeStore.getState().preference === "system") refresh();
  });

  // Sync on storage events (cross-tab) — validate incoming value
  window.addEventListener("storage", (e) => {
    if (e.key === SKY_HOUR_KEY) {
      refresh();
      return;
    }
    if (e.key !== STORAGE_KEY) return;
    const pref: ThemePreference = isPreference(e.newValue) ? e.newValue : "day";
    useThemeStore.setState({ preference: pref, ...applyToDOM(pref) });
  });
}
