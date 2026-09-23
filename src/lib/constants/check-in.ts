import { Camera, Check, CloudRain, MessageSquare, Mic } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The ways a habit can be checked in.
 *
 * "quick" completes straight away; the others open the completion sheet on
 * the matching step (camera, recorder, note, rain-check reason).
 */
export type CheckInAction =
  | "quick"
  | "content"
  | "voice"
  | "message"
  | "rain_check";

export interface CheckInOption {
  action: CheckInAction;
  /** Used for the icon's accessible name on the habit card drawer. */
  label: string;
  icon: LucideIcon;
  /** Token reference — each action keeps the same hue everywhere it appears. */
  color: string;
}

/**
 * Ordered left-to-right as they appear in the habit card's check-in drawer.
 * "Quick" sits first: it is the most common choice and lands closest to the
 * thumb after a swipe.
 */
export const CHECK_IN_OPTIONS: readonly CheckInOption[] = [
  {
    action: "quick",
    label: "Quick check-in",
    icon: Check,
    color: "var(--color-success)",
  },
  {
    action: "content",
    label: "Photo or video",
    icon: Camera,
    color: "var(--color-brand)",
  },
  {
    action: "voice",
    label: "Voice note",
    icon: Mic,
    color: "var(--color-encourage)",
  },
  {
    action: "message",
    label: "Written note",
    icon: MessageSquare,
    color: "var(--color-streak)",
  },
  {
    action: "rain_check",
    label: "Rain check",
    icon: CloudRain,
    color: "var(--color-rain)",
  },
] as const;
