/**
 * The habit color palette.
 *
 * Color is a plain visual label chosen by the user — it carries no meaning
 * and is not derived from any category, type or tag. Presented as one row of
 * swatches, the way Google Calendar does it.
 *
 * Each hue is picked to stay legible against both the light (#fafaf9) and
 * dark (#1a1a1e) grounds, since a habit's color tints its whole card.
 */
export interface HabitColor {
  /** Hex value stored on habits.color. */
  value: string;
  /** Accessible name for the swatch button. */
  label: string;
}

export const HABIT_COLORS: readonly HabitColor[] = [
  { value: "#EF4444", label: "Red" },
  { value: "#F97316", label: "Orange" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#22C55E", label: "Green" },
  { value: "#14B8A6", label: "Teal" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#6366F1", label: "Indigo" },
  { value: "#8B5CF6", label: "Violet" },
  { value: "#EC4899", label: "Pink" },
  { value: "#64748B", label: "Slate" },
] as const;

/**
 * No colour is the default, and it is a real choice rather than an absence:
 * a habit starts as a plain card and picks up a colour only if its owner
 * wants one. Most lists then stay neutral, which is what keeps a colour
 * meaningful on the few habits that carry one.
 *
 * Stored as NULL on habits.color — see migration 026.
 */
export const DEFAULT_HABIT_COLOR: string | null = null;

/** True when a habit has deliberately not been given a colour. */
export function hasNoColor(color: string | null | undefined): boolean {
  return color == null || color === "";
}

/**
 * Hex comparison that tolerates the casing differences across stored rows.
 * Null and "" are the same absence of colour, so they compare equal.
 */
export function isSameColor(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}
