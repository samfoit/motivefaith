/**
 * The "Send to…" picker's habits, when the server can't be asked for them.
 *
 * Online the picker gets them from `get_incomplete_habits_today`. Offline that
 * call fails, and the picker used to say "Failed to load habits" over a take
 * that could otherwise be sent — so it falls back to the dashboard's cached
 * data, which is persisted for exactly this, and which an offline check-in
 * updates too.
 */

import type { DashboardData } from "@/lib/data/dashboard";
import type { PickerHabit } from "@/components/habits/ShareTargetPicker";
import { isHabitDueOn } from "@/lib/utils/schedule";
import { toDateKey } from "@/lib/utils/timezone";

/**
 * Today's habits with nothing logged yet, in the RPC's shape and order.
 *
 * The same rule as `get_incomplete_habits_today`: due today — scheduled, or an
 * earlier rain check moved onto today — and no completion of any kind today,
 * a rain check included. The dashboard holds only unpaused habits, oldest
 * first, as the RPC returns them.
 *
 * Who a habit's check-in already reaches isn't in the dashboard's data. It
 * comes from `lastFetched`, the RPC's last answer, where there is one; a
 * habit missing from it reaches no one here, so its partners can still be
 * picked by hand, and `share_capture` skips anyone it would reach twice.
 */
export function habitsLeftToday(
  data: DashboardData,
  lastFetched: PickerHabit[] = [],
  now: Date = new Date(),
): PickerHabit[] {
  const timezone = data.timezone;
  const todayKey = toDateKey(now, timezone);
  const reach = new Map(lastFetched.map((h) => [h.id, h]));

  return data.habits
    .filter(
      (habit) =>
        isHabitDueOn(habit, now, todayKey, timezone) &&
        !habit.completions.some(
          (c) => toDateKey(c.completed_at, timezone) === todayKey,
        ),
    )
    .map((habit) => ({
      id: habit.id,
      title: habit.title,
      emoji: habit.emoji,
      color: habit.color,
      streak_current: habit.streak_current ?? 0,
      frequency: habit.frequency,
      partner_ids: reach.get(habit.id)?.partner_ids ?? [],
      group_ids: reach.get(habit.id)?.group_ids ?? [],
      private_checkins: habit.private_checkins,
    }));
}
