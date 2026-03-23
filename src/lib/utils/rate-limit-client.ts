/**
 * Client-side rate limiter for auth forms.
 *
 * Tracks submission timestamps in sessionStorage so limits survive
 * page refreshes within the same tab session. This is a first layer
 * of defence — Supabase Auth also enforces server-side rate limits.
 */

const STORAGE_PREFIX = "motive-rl:";

function getTimestamps(key: string): number[] {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch (err) {
    console.warn("Failed to read rate-limit timestamps:", err);
    return [];
  }
}

function setTimestamps(key: string, timestamps: number[]): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(timestamps));
  } catch (err) {
    // sessionStorage may be unavailable (private browsing, storage full).
    // Fall through — the limiter degrades to a no-op, Supabase server
    // rate limits remain the primary defence.
    console.warn("Failed to write rate-limit timestamps:", err);
  }
}

/**
 * Returns `true` if the action is allowed, `false` if rate-limited.
 *
 * @param key   A unique identifier for the action (e.g. "login", "signup").
 * @param limit Max attempts allowed within `windowMs`.
 * @param windowMs  Time window in milliseconds.
 */
export function checkClientRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();

  // Evict timestamps outside the window
  const timestamps = getTimestamps(key).filter((t) => now - t < windowMs);

  if (timestamps.length >= limit) {
    setTimestamps(key, timestamps);
    return false; // rate-limited
  }

  timestamps.push(now);
  setTimestamps(key, timestamps);
  return true;
}

/**
 * Returns the number of seconds until the next attempt is allowed, or 0 if
 * the action is not currently rate-limited.
 */
export function getRateLimitRetryAfter(key: string, windowMs: number): number {
  const timestamps = getTimestamps(key);
  if (timestamps.length === 0) return 0;

  const oldest = timestamps[0];
  const elapsed = Date.now() - oldest;
  const remaining = windowMs - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Check the client rate limit and show a toast if exceeded.
 * Returns `true` if allowed, `false` if rate-limited.
 */
export function checkRateLimitWithToast(
  key: string,
  limit: number,
  windowMs: number,
  showToast: (opts: { title: string; description: string; variant: "error" }) => void,
): boolean {
  if (!checkClientRateLimit(key, limit, windowMs)) {
    const retry = getRateLimitRetryAfter(key, windowMs);
    showToast({
      title: "Too many attempts",
      description: `Please wait ${retry}s before trying again.`,
      variant: "error",
    });
    return false;
  }
  return true;
}
