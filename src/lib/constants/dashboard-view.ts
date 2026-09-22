/**
 * Which dashboard view (day / week / month) the user last used.
 *
 * Stored in a cookie rather than localStorage so the **server** can render the
 * correct view directly. With localStorage the server always rendered "day",
 * the client read the stored value after hydration, and switching to week or
 * month mounted a lazily-imported component whose chunk had not been fetched
 * yet — producing a bare gray placeholder ~2s after the page already looked
 * finished (measured at 290ms; see DIAGNOSIS.md R5).
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
