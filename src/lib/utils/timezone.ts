/**
 * Timezone-aware date utilities.
 *
 * Uses the native Intl API (no external dependencies) to ensure consistent
 * date handling across server components, client components, and the database.
 *
 * Key rule: always convert timestamps to the user's IANA timezone before
 * comparing dates. Never rely on the JS runtime's local timezone since it
 * differs between server (often UTC) and client (browser TZ).
 */

/** Fallback when no timezone has been configured yet. */
export const DEFAULT_TIMEZONE = "UTC";

// ---------------------------------------------------------------------------
// Cached Intl.DateTimeFormat instances — avoids re-creating formatters on
// every call (construction is ~10× slower than .format()).  Keyed by timezone;
// typically 1-2 entries per session so no eviction is needed.
// ---------------------------------------------------------------------------

const dateKeyFmtCache = new Map<string, Intl.DateTimeFormat>();
function getDateKeyFmt(tz: string): Intl.DateTimeFormat {
  let f = dateKeyFmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); dateKeyFmtCache.set(tz, f); }
  return f;
}

const weekdayFmtCache = new Map<string, Intl.DateTimeFormat>();
function getWeekdayFmt(tz: string): Intl.DateTimeFormat {
  let f = weekdayFmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }); weekdayFmtCache.set(tz, f); }
  return f;
}

/**
 * Detect the user's IANA timezone from the browser.
 * Only meaningful in client code — on the server this returns UTC.
 */
export function getBrowserTimezone(): string {
  if (typeof Intl === "undefined") return DEFAULT_TIMEZONE;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Convert a Date or ISO string to a YYYY-MM-DD date key in a specific timezone.
 * Uses the `en-CA` locale which reliably formats as YYYY-MM-DD.
 */
export function toDateKey(date: Date | string, timeZone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getDateKeyFmt(timeZone).format(d);
}

/**
 * Get today's date as a YYYY-MM-DD string in a specific timezone.
 */
export function todayDateKey(timeZone: string): string {
  return toDateKey(new Date(), timeZone);
}

/**
 * Get the day of week (0 = Sunday, 6 = Saturday) for a Date/ISO string
 * in a specific timezone.
 */
export function getDayOfWeek(date: Date | string, timeZone: string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = getWeekdayFmt(timeZone).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday ?? "Sun"] ?? 0;
}

/**
 * Subtract `days` from a YYYY-MM-DD date key and return a new YYYY-MM-DD key.
 * Uses UTC noon to avoid DST boundary issues.
 */
export function subtractDays(dateKey: string, days: number): string {
  const d = new Date(dateKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Return the current time as "HH:MM" (24-hour) in a specific timezone.
 */
export function currentTimeHHMM(timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
  return fmt.format(new Date());
}

/**
 * Return [start, end) ISO-8601 timestamps with UTC offset for a full day in
 * the given IANA timezone. Use with Supabase `.gte()` / `.lt()` filters on
 * `timestamptz` columns so PostgreSQL compares in the correct timezone.
 *
 * The offset is sampled at noon to safely avoid DST transition windows (~2 am).
 */
export function dayBoundsUtc(
  dateKey: string,
  tz: string,
): [start: string, end: string] {
  const noon = new Date(`${dateKey}T12:00:00Z`);

  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      hour12: false,
    }).formatToParts(noon);

  const part = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  const utcP = fmt("UTC");
  const tzP = fmt(tz);

  let offsetMin =
    part(tzP, "hour") * 60 +
    part(tzP, "minute") -
    (part(utcP, "hour") * 60 + part(utcP, "minute"));

  const dayDiff = part(tzP, "day") - part(utcP, "day");
  if (dayDiff === 1 || dayDiff < -1) offsetMin += 1440;
  else if (dayDiff === -1 || dayDiff > 1) offsetMin -= 1440;

  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const offset = `${sign}${hh}:${mm}`;

  const nextDay = subtractDays(dateKey, -1);
  return [`${dateKey}T00:00:00${offset}`, `${nextDay}T00:00:00${offset}`];
}
