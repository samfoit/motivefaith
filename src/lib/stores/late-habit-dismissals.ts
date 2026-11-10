import { useMemo, useSyncExternalStore } from "react";

/**
 * Late habits (lateHabitKey) dismissed on this device. A chat's card and the
 * inbox list the same ones, and share this, so dismissing one in either is
 * gone from both, and from the bell's count.
 *
 * Each is kept with when it was dismissed and forgotten after a few days, as
 * one is never listed for more than two. In localStorage, so a dismissal
 * outlasts closing the app; cleared at sign-out with the rest of the user's
 * data, since it names other people's habits.
 */

export const LATE_DISMISSED_KEY = "motive:late-dismissed";
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const listeners = new Set<() => void>();
/** What storage refused (blocked, full, a private window), until the app closes. */
let unsaved: string | null = null;

/** As stored: a string, so the snapshot only changes when the contents do. */
function read(): string {
  if (unsaved !== null) return unsaved;
  try {
    return localStorage.getItem(LATE_DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, at]) => typeof at === "number"),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function dismissLateHabits(keys: string[]) {
  const now = Date.now();
  const kept = Object.fromEntries(
    Object.entries(parse(read())).filter(([, at]) => now - at < KEEP_MS),
  );
  for (const key of keys) kept[key] = now;
  const raw = JSON.stringify(kept);
  try {
    localStorage.setItem(LATE_DISMISSED_KEY, raw);
    unsaved = null;
  } catch {
    unsaved = raw;
  }
  notify();
}

/** At sign-out: the next person on this device starts with none. */
export function forgetLateHabitDismissals() {
  unsaved = null;
  try {
    localStorage.removeItem(LATE_DISMISSED_KEY);
  } catch {
    // Storage unavailable: nothing was kept there.
  }
  notify();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab dismissed one.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === LATE_DISMISSED_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The late habits dismissed on this device. Null until mounted: the server
 * can't know them, so anything that lists late habits draws them only once
 * this is known, and never shows a dismissed one for a moment first.
 */
export function useDismissedLateHabits(): ReadonlySet<string> | null {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => (raw === null ? null : new Set(Object.keys(parse(raw)))), [raw]);
}
