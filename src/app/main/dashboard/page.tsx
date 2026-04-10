import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getAuthUser, getProfile, createServerSupabase } from "@/lib/supabase/server";
import { DashboardClient } from "./dashboard-client";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  todayDateKey,
  subtractDays,
  DEFAULT_TIMEZONE,
} from "@/lib/utils/timezone";
import { computeEffectiveStreak } from "@/lib/utils/streak";
import { MAX_COMPLETIONS_FETCH } from "@/lib/constants/limits";

async function fetchHabits(supabase: Awaited<ReturnType<typeof createServerSupabase>>, userId: string) {
  const { data } = await supabase
    .from("habits")
    .select("id, user_id, title, description, emoji, category, color, frequency, schedule, time_window, streak_current, streak_best, total_completions, is_paused, is_shared, created_at")
    .eq("user_id", userId)
    .eq("is_paused", false)
    .order("created_at");
  return data ?? [];
}

async function fetchCompletions(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  habitIds: string[],
  fetchStartKey: string,
) {
  if (habitIds.length === 0) return [];
  const limit = Math.min(habitIds.length * 31, MAX_COMPLETIONS_FETCH);
  const { data } = await supabase
    .from("completions")
    .select("id, habit_id, completed_at, completion_type")
    .in("habit_id", habitIds)
    .gte("completed_at", fetchStartKey + "T00:00:00Z")
    .order("completed_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** Skeleton for the habit list area while data streams in. */
function HabitsSkeleton() {
  return (
    <div className="space-y-6">
      {/* View toggle skeleton */}
      <Skeleton variant="rect" width="100%" height={40} className="rounded-lg" />
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton variant="text" width={120} height={16} />
          <Skeleton variant="text" width={32} height={16} />
        </div>
        <Skeleton variant="rect" width="100%" height={8} className="rounded-full" />
      </div>
      {/* Habit cards */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm border-l-[3px] border-gray-200">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton variant="circle" width={28} height={28} />
                <Skeleton variant="text" width="60%" height={20} />
              </div>
              <Skeleton variant="text" width="40%" height={14} />
            </div>
            <Skeleton variant="circle" width={40} height={40} />
          </div>
        ))}
      </div>
    </div>
  );
}

function getGreeting(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  }).formatToParts(new Date());
  const parsed = parseInt(
    parts.find((p) => p.type === "hour")?.value ?? "12",
    10,
  );
  const hour = Number.isNaN(parsed) ? 12 : parsed;
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Reuses the cached profile from AuthGate — no extra DB call
  const profile = await getProfile(user.id);

  const timeZone = profile?.timezone || DEFAULT_TIMEZONE;
  const greeting = getGreeting(timeZone);
  const firstName = profile?.display_name?.split(" ")[0];
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date());

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Greeting streams immediately */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="font-display font-bold text-text-primary"
              style={{ fontSize: "var(--text-2xl)" }}
            >
              {greeting}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              {today}
            </p>
          </div>
          <Link
            href="/main/habits/new"
            aria-label="Create new habit"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-brand text-text-primary hover:bg-brand-hover transition-colors"
          >
            <Plus className="w-5 h-5" />
          </Link>
        </div>

        {/* Habits stream in via Suspense */}
        <Suspense fallback={<HabitsSkeleton />}>
          <HabitsSection userId={user.id} timezone={timeZone} />
        </Suspense>
      </div>
    </div>
  );
}

/** Async Server Component — fetches inside Suspense boundary. */
async function HabitsSection({
  userId,
  timezone,
}: {
  userId: string;
  timezone: string;
}) {
  const supabase = await createServerSupabase();

  // Challenges query doesn't depend on habitIds — start it parallel with habits
  const [habits, { data: challenges }] = await Promise.all([
    fetchHabits(supabase, userId),
    supabase
      .from("group_challenges")
      .select("id, title, emoji")
      .eq("is_active", true),
  ]);

  const habitIds = habits.map((h) => h.id);
  const today = todayDateKey(timezone);
  const monthStartKey = today.slice(0, 7) + "-01";
  const twoWeeksAgoKey = subtractDays(today, 14);
  const fetchStartKey =
    monthStartKey < twoWeeksAgoKey ? monthStartKey : twoWeeksAgoKey;

  const [recentCompletions, { data: participants }] =
    await Promise.all([
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
      { title: c.title, emoji: c.emoji ?? "\uD83C\uDFAF" },
    ]),
  );

  const challengeMap = new Map<string, { title: string; emoji: string }>();
  for (const p of participants ?? []) {
    if (!p.habit_id) continue;
    const challenge = challengeLookup.get(p.challenge_id);
    if (challenge) {
      challengeMap.set(p.habit_id, challenge);
    }
  }

  const habitsWithCompletions = habits.map((habit) => {
    const habitCompletions = (recentCompletions ?? [])
      .filter(
        (c): c is typeof c & { completed_at: string; completion_type: NonNullable<typeof c.completion_type> } =>
          c.habit_id === habit.id && c.completed_at != null && c.completion_type != null,
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

  return (
    <DashboardClient
      habits={habitsWithCompletions}
      timezone={timezone}
    />
  );
}
