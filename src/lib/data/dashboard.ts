/**
 * The dashboard's data, in one place.
 *
 * Lifted out of `src/app/main/dashboard/page.tsx`, which used to fetch this
 * server-side and pass it down as props. That embedded the user's name, habits
 * and streaks directly in the HTML, which is why the service worker was never
 * allowed to cache the dashboard document — and therefore why the app showed a
 * dead-end "You're offline" page for a screen the user had open moments
 * earlier (DIAGNOSIS.md R1).
 *
 * Now it is served as JSON from `/api/dashboard`, read through React Query and
 * persisted to IndexedDB, so the document itself carries no user data and the
 * cached shell has something real to render offline.
 */

import type { createServerSupabase } from "@/lib/supabase/server";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import { computeEffectiveStreak } from "@/lib/utils/streak";
import { todayDateKey, subtractDays, DEFAULT_TIMEZONE } from "@/lib/utils/timezone";
import { MAX_COMPLETIONS_FETCH } from "@/lib/constants/limits";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabase>>;

export interface DashboardData {
  habits: HabitWithCompletions[];
  /** The user's IANA timezone, so the client formats dates the same way. */
  timezone: string;
  /** First name only — all the greeting needs. */
  firstName: string | null;
}

async function fetchHabits(supabase: SupabaseServerClient, userId: string) {
  const { data } = await supabase
    .from("habits")
    // Inline literal, not a constant: postgrest-js infers the row type from
    // this string, and a `const` widens it to `string` and erases the types.
    .select("id, user_id, title, description, emoji, color, frequency, schedule, time_window, streak_current, streak_best, total_completions, is_paused, visibility, created_at")
    .eq("user_id", userId)
    .eq("is_paused", false)
    .order("created_at");
  return data ?? [];
}

async function fetchCompletions(
  supabase: SupabaseServerClient,
  habitIds: string[],
  fetchStartKey: string,
) {
  if (habitIds.length === 0) return [];
  const limit = Math.min(habitIds.length * 31, MAX_COMPLETIONS_FETCH);
  const { data } = await supabase
    .from("completions")
    .select("id, habit_id, completed_at, completion_type, rain_check_moved_to")
    .in("habit_id", habitIds)
    .gte("completed_at", fetchStartKey + "T00:00:00Z")
    .order("completed_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Everything the dashboard renders.
 *
 * The habits/challenges pair is started before the profile is awaited: neither
 * depends on it, and awaiting the profile first serialised two independent
 * round trips for no reason (DIAGNOSIS.md R6).
 */
export async function fetchDashboard(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<DashboardData> {
  const baseData = Promise.all([
    fetchHabits(supabase, userId),
    supabase.from("group_challenges").select("id, title, emoji").eq("is_active", true),
  ]);
  // Mark handled: nothing awaits this until after the profile resolves, and a
  // transport-level rejection in that window would otherwise be unhandled.
  // The awaiting consumer below still sees the rejection.
  baseData.catch(() => {});

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone")
    .eq("id", userId)
    .maybeSingle();

  const timezone = profile?.timezone || DEFAULT_TIMEZONE;
  const [habits, { data: challenges }] = await baseData;

  const habitIds = habits.map((h) => h.id);
  const today = todayDateKey(timezone);
  const monthStartKey = today.slice(0, 7) + "-01";
  const twoWeeksAgoKey = subtractDays(today, 14);
  const fetchStartKey =
    monthStartKey < twoWeeksAgoKey ? monthStartKey : twoWeeksAgoKey;

  const [recentCompletions, { data: participants }] = await Promise.all([
    fetchCompletions(supabase, habitIds, fetchStartKey),
    habitIds.length > 0
      ? supabase
        .from("group_challenge_participants")
        .select("habit_id, challenge_id")
        .eq("user_id", userId)
        .in("habit_id", habitIds)
      : Promise.resolve({
        data: [] as { habit_id: string | null; challenge_id: string }[],
      }),
  ]);

  const challengeLookup = new Map(
    (challenges ?? []).map((c) => [
      c.id,
      { title: c.title, emoji: c.emoji ?? "🎯" },
    ]),
  );

  const challengeMap = new Map<string, { title: string; emoji: string }>();
  for (const p of participants ?? []) {
    if (!p.habit_id) continue;
    const challenge = challengeLookup.get(p.challenge_id);
    if (challenge) challengeMap.set(p.habit_id, challenge);
  }

  const habitsWithCompletions = habits.map((habit) => {
    const habitCompletions = (recentCompletions ?? [])
      .filter(
        (c): c is typeof c & {
          completed_at: string;
          completion_type: NonNullable<typeof c.completion_type>;
        } =>
          c.habit_id === habit.id &&
          c.completed_at != null &&
          c.completion_type != null,
      )
      .map(({ id, completed_at, completion_type }) => ({
        id,
        completed_at,
        completion_type,
      }));

    return {
      ...habit,
      streak_current: computeEffectiveStreak(habit, habitCompletions, timezone),
      completions: habitCompletions,
      challenge: challengeMap.get(habit.id) ?? null,
    };
  });

  return {
    habits: habitsWithCompletions,
    timezone,
    firstName: profile?.display_name?.split(" ")[0] ?? null,
  };
}
