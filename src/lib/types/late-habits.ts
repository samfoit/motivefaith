/**
 * A habit someone else could use a word about (`get_chat_late_habits`,
 * migration 053): one the viewer partners on, or one in a group they're in.
 *
 *   remind     today's window closed with nothing logged, and the owner's day
 *              isn't over: they may just not have logged it.
 *   encourage  their day ended with nothing logged: the day was missed. It
 *              shows through their next day, until they check in again.
 *
 * Gone once the viewer writes to them (or in the group) after it closed.
 */
export interface LateHabit {
  habitId: string;
  title: string;
  emoji: string;
  color: string;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
  kind: "remind" | "encourage";
  /** The owner's date the window was on, as YYYY-MM-DD. */
  day: string;
  /** When that window closed, by the owner's clock. */
  closedAt: string;
}

/** The raw shape `get_chat_late_habits` returns, before it is camel-cased. */
export interface LateHabitRpcRow {
  habit_id: string;
  title: string;
  emoji: string;
  color: string;
  owner_id: string;
  owner_name: string;
  owner_avatar: string | null;
  kind: "remind" | "encourage";
  day: string;
  closed_at: string;
}

export function toLateHabit(row: LateHabitRpcRow): LateHabit {
  return {
    habitId: row.habit_id,
    title: row.title,
    emoji: row.emoji,
    color: row.color,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerAvatar: row.owner_avatar,
    kind: row.kind,
    day: row.day,
    closedAt: row.closed_at,
  };
}

/**
 * One habit on one day. A dismissal is of this, so dismissing today's
 * reminder doesn't hide tomorrow's.
 */
export function lateHabitKey(habit: Pick<LateHabit, "habitId" | "day">): string {
  return `${habit.habitId}:${habit.day}`;
}
