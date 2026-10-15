import { create } from "zustand";
import { ALL_VARS, PINNED_HOUR, hourOf, palette } from "@/lib/lamplight/palette";

/**
 * "day" (shown as Auto) is Lamplight's default: the colors and the sky follow
 * the local hour. Light and Dark pin a clear midday or a lamplit night.
 *
 * There is no "system" choice. Auto already answers "do the sensible thing",
 * and following the OS would mean a pinned midday or night out of step with
 * the actual hour. A "system" stored before Lamplight is not a valid value
 * any more, so it reads as Auto like any other unknown one.
 */
export type ThemePreference = "day" | "light" | "dark";
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
  return v === "day" || v === "light" || v === "dark";
}

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "day";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "day";
  } catch {
    return "day";
  }
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
  return { resolved: pref, hour: PINNED_HOUR[pref] };
}

function setThemeColor(color: string) {
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", color));
}

/** How long the crossfade class stays on: the 450ms fade plus a margin. */
const SHIFT_MS = 600;
let shiftTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Crossfade the whole screen when the family flips: at sunrise and nightfall
 * in Auto mode, or on a switch between Light and Dark. Inside a family the
 * palette moves a little each minute and needs no help; across families every
 * surface and text color jumps at once, so for that moment alone everything
 * transitions its colors (`.theme-shift` in globals.css). Only for that
 * moment: a standing transition on every element would tax every repaint.
 */
function crossfade(root: HTMLElement) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("theme-shift");
  clearTimeout(shiftTimer);
  shiftTimer = setTimeout(() => root.classList.remove("theme-shift"), SHIFT_MS);
}

function applyToDOM(pref: ThemePreference): Applied {
  const applied = resolve(pref);
  if (typeof document === "undefined") return applied;
  const root = document.documentElement;

  // Added before the colors change, so the transition is in place when they do.
  const wasDark = root.getAttribute("data-theme") === "dark";
  if (wasDark !== (applied.resolved === "dark")) crossfade(root);

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
 * Initialize theme on mount — syncs store with DOM and follows the clock in
 * "day" mode.
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
