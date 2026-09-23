import type { Database } from "@/lib/supabase/types";

export type HabitVisibility = Database["public"]["Enums"]["habit_visibility"];
export type PartnerStatus = Database["public"]["Enums"]["habit_partner_status"];

/**
 * One row of `get_partner_inbox` — something pending that is yours to answer.
 *
 * `direction` is the whole point: an invitation came from the habit's owner and
 * is asking you to watch, a request came from a friend asking to watch you.
 * The RPC only ever returns rows the caller is the one to answer, so there is
 * no "waiting on them" state here.
 */
export interface PartnerInboxItem {
  shareId: string;
  habitId: string;
  habitTitle: string;
  habitEmoji: string;
  habitColor: string;
  visibility: HabitVisibility;
  direction: "invite" | "request";
  person: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    username: string;
  };
  createdAt: string;
}

/** The raw shape `get_partner_inbox` returns, before it is camel-cased. */
export interface PartnerInboxRpcRow {
  share_id: string;
  habit_id: string;
  habit_title: string;
  habit_emoji: string;
  habit_color: string;
  visibility: HabitVisibility;
  direction: "invite" | "request";
  person_id: string;
  person_name: string;
  person_avatar: string | null;
  person_username: string;
  created_at: string;
}

export function toPartnerInboxItem(row: PartnerInboxRpcRow): PartnerInboxItem {
  return {
    shareId: row.share_id,
    habitId: row.habit_id,
    habitTitle: row.habit_title,
    habitEmoji: row.habit_emoji,
    habitColor: row.habit_color,
    visibility: row.visibility,
    direction: row.direction,
    person: {
      id: row.person_id,
      display_name: row.person_name,
      avatar_url: row.person_avatar,
      username: row.person_username,
    },
    createdAt: row.created_at,
  };
}

/**
 * One row of `get_profile_habits` — a habit on someone's profile, as far as
 * you are allowed to see it.
 *
 * `streakCurrent` is null unless you are an accepted partner. That is enforced
 * server-side; the null here is the absence of a fact, not a loading state.
 */
export interface ProfileHabit {
  habitId: string;
  title: string;
  emoji: string;
  color: string;
  visibility: HabitVisibility;
  /** null when there is no partnership row between you and this habit at all. */
  partnerStatus: PartnerStatus | null;
  shareId: string | null;
  /** You are the one who started the pending partnership. */
  isInitiator: boolean;
  streakCurrent: number | null;
  streakBest: number | null;
}

export interface ProfileHabitRpcRow {
  habit_id: string;
  title: string;
  emoji: string;
  color: string;
  visibility: HabitVisibility;
  partner_status: PartnerStatus | null;
  share_id: string | null;
  is_initiator: boolean | null;
  streak_current: number | null;
  streak_best: number | null;
}

export function toProfileHabit(row: ProfileHabitRpcRow): ProfileHabit {
  return {
    habitId: row.habit_id,
    title: row.title,
    emoji: row.emoji,
    color: row.color,
    visibility: row.visibility,
    partnerStatus: row.partner_status,
    shareId: row.share_id,
    isInitiator: row.is_initiator ?? false,
    streakCurrent: row.streak_current,
    streakBest: row.streak_best,
  };
}
