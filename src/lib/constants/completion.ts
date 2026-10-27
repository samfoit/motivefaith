export const COMPLETION_TYPES = [
  "photo",
  "video",
  "message",
  "quick",
  "voice",
  "rain_check",
] as const;

export type CompletionType = (typeof COMPLETION_TYPES)[number];

export const VALID_COMPLETION_TYPES = new Set<string>(COMPLETION_TYPES);

/**
 * A rain check is a deliberate skip, not a completion. It holds the streak
 * but never counts toward totals, so most surfaces need to tell the two
 * apart rather than treating every completion row alike.
 */
export function isRainCheck(type: string | null | undefined): boolean {
  return type === "rain_check";
}

/**
 * The SQLSTATE insert_completion() refuses a paused habit's check-in with
 * (047): object_not_in_prerequisite_state, the prerequisite being to resume
 * it. share_capture() and insert_private_completion() pass it through.
 */
export const HABIT_PAUSED_CODE = "55000";

/**
 * A check-in refused because its habit is paused — since the page was
 * loaded, often, from another device.
 */
export function isHabitPausedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === HABIT_PAUSED_CODE
  );
}
