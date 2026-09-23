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
