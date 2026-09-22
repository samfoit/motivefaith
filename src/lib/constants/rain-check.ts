import { Clock, MoreHorizontal, Moon, Plane, Thermometer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Why someone skipped today. Optional — a rain check with no reason is
 * still a rain check; the reason exists so partners get context without
 * the user having to write a sentence.
 */
export type RainCheckReason = "sick" | "travel" | "rest" | "busy" | "other";

export interface RainCheckReasonOption {
  code: RainCheckReason;
  /** Chip label in the reason sheet. */
  label: string;
  icon: LucideIcon;
}

/** Ordered as they appear in the reason sheet, commonest first. */
export const RAIN_CHECK_REASONS: readonly RainCheckReasonOption[] = [
  { code: "sick", label: "Sick", icon: Thermometer },
  { code: "travel", label: "Traveling", icon: Plane },
  { code: "rest", label: "Rest day", icon: Moon },
  { code: "busy", label: "Busy", icon: Clock },
  { code: "other", label: "Other", icon: MoreHorizontal },
] as const;

export const VALID_RAIN_CHECK_REASONS = new Set<string>(
  RAIN_CHECK_REASONS.map((r) => r.code),
);

/**
 * Prose form, used wherever a reason is read rather than picked — feed
 * previews, history rows, push bodies. Kept in step with
 * rain_check_reason_label() in migration 025 so the copy a partner sees in
 * a push matches what they see in the app.
 */
export const RAIN_CHECK_REASON_LABELS: Record<RainCheckReason, string> = {
  sick: "Feeling unwell",
  travel: "Traveling",
  rest: "Taking a rest day",
  busy: "Busy day",
  other: "No reason given",
};

export function rainCheckReasonLabel(
  reason: string | null | undefined,
): string {
  if (reason && reason in RAIN_CHECK_REASON_LABELS) {
    return RAIN_CHECK_REASON_LABELS[reason as RainCheckReason];
  }
  return RAIN_CHECK_REASON_LABELS.other;
}

/**
 * How far ahead a rain check may be moved. Mirrors chk_rain_check_moved_to in
 * migration 027, and is bounded by the 14-day walk-back both streak paths use
 * to find the previous scheduled day — a promise beyond that could never be
 * seen. The constraint, not the client, is authoritative: it is evaluated
 * against `completed_date` in the habit owner's timezone.
 */
export const RAIN_CHECK_MAX_MOVE_DAYS = 14;

/**
 * How far out the move picker looks. A week, so each weekday the habit is
 * free on appears exactly once — offering the same weekday twice would be
 * more choice than it is worth.
 */
export const RAIN_CHECK_MOVE_WINDOW_DAYS = 7;

/** Is this a well-formed YYYY-MM-DD date key? */
export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
