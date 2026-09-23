import type { CompletionType } from "@/lib/constants/completion";
// ---------------------------------------------------------------------------
// Feed redesign types — Snapchat-style friend-grouped feed
// ---------------------------------------------------------------------------

/** Profile shape used across feed views */
export type FeedProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username: string;
};

/** A shared habit with owner info + streak data */
export type JourneyHabit = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  streak_current: number;
  streak_best: number;
  /** The user who owns this habit */
  owner_id: string;
  /** Whether the current user owns this habit */
  isOwner: boolean;
  /** Whether this habit has been completed today by its owner */
  completedToday: boolean;
  /** Skipped today on purpose — the streak is held, not broken. */
  rainCheckedToday?: boolean;
  /** Where today's rain check was moved to, when it was moved at all. */
  rainCheckMovedTo?: string | null;
};

/** A completion in the journey timeline */
export type JourneyCompletion = {
  id: string;
  habit_id: string;
  completion_type: CompletionType;
  /** Set only on a rain check — why they skipped. */
  rain_check_reason?: string | null;
  /** Set only on a rain check that was moved rather than skipped. */
  rain_check_moved_to?: string | null;
  evidence_url: string | null;
  notes: string | null;
  completed_at: string;
  /** The user who completed it */
  user_id: string;
  /** Whether the current user performed this completion */
  isMe: boolean;
  /** Denormalized habit info for display */
  habit_emoji: string;
  habit_title: string;
  habit_color: string;
};

/** An encouragement in the journey timeline */
export type JourneyEncouragement = {
  id: string;
  encouragement_type: "nudge" | "message" | "emoji" | "voice";
  content: string | null;
  created_at: string;
  /** The user who sent it */
  user_id: string;
  /** Whether the current user sent it */
  isMe: boolean;
  sender_name: string;
  /** Linked completion (for heart reactions) */
  completion_id?: string | null;
};

/** A single row in the friend feed list (Level 1) */
export type FriendFeedRow = {
  friend: FeedProfile;
  /** Shared habits between the two users (both directions) */
  sharedHabits: { emoji: string; title: string }[];
  /** ISO timestamp of the latest completion across all shared habits */
  latestActivity: string | null;
  /** Preview text for the latest activity */
  previewText: string;
  /** Whether there's activity the user hasn't seen */
  hasNewActivity: boolean;
  /** When the friendship was created */
  friendshipSince: string;
};

/** Full journey data for the friend detail page (Level 2) */
export type JourneyData = {
  friend: FeedProfile;
  friendshipSince: string;
  habits: JourneyHabit[];
  completions: JourneyCompletion[];
  encouragements: JourneyEncouragement[];
};
