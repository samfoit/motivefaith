/**
 * Which dashboard view (day / week / month) the user last used.
 *
 * Still a cookie, but no longer for the original reason. It was a cookie so
 * the *server* could render the right view directly: with localStorage the
 * server always rendered "day", the client corrected it in an effect after
 * hydration, and switching to week or month mounted a lazily-imported
 * component whose chunk had not been fetched — a bare gray placeholder ~2s
 * after the page looked finished (measured at 290ms; DIAGNOSIS.md R5).
 *
 * The dashboard document is now user-agnostic so it can be cached for offline
 * use, so the server no longer reads this at all. The cookie stays because it
 * is readable *synchronously* on the client (`readDashboardView`), which keeps
 * R5 fixed: the correct view is chosen in the very first client render, in a
 * `useState` initializer, with no effect and therefore no swap. localStorage
 * would work equally well here; the cookie is simply what is already written,
 * already parsed, and already covered by tests.
 *
 * Not sensitive, so a plain readable cookie is fine.
 */
export const DASHBOARD_VIEW_COOKIE = "motive-dashboard-view";

export const DASHBOARD_VIEWS = ["day", "week", "month"] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];
export const DEFAULT_DASHBOARD_VIEW: DashboardView = "day";

/** Narrow an untrusted value (cookie, storage) to a valid view. */
export function parseDashboardView(value: string | undefined | null): DashboardView {
  return (DASHBOARD_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as DashboardView)
    : DEFAULT_DASHBOARD_VIEW;
}

/** One year — this is a preference, not a session value. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function persistDashboardView(view: DashboardView) {
  document.cookie = `${DASHBOARD_VIEW_COOKIE}=${view}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Read the stored view synchronously, for a `useState` initializer.
 *
 * Returns the default during SSR (no `document`), which is what keeps the
 * server and the first client render in agreement.
 */
export function readDashboardView(): DashboardView {
  if (typeof document === "undefined") return DEFAULT_DASHBOARD_VIEW;
  for (const part of document.cookie.split("; ")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === DASHBOARD_VIEW_COOKIE) {
      return parseDashboardView(part.slice(eq + 1));
    }
  }
  return DEFAULT_DASHBOARD_VIEW;
}
