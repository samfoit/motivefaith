import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getAuthUser, getProfile, createServerSupabase } from "@/lib/supabase/server";
import { DashboardClient } from "./dashboard-client";
import {
  todayDateKey,
  subtractDays,
  DEFAULT_TIMEZONE,
} from "@/lib/utils/timezone";
import { computeEffectiveStreak } from "@/lib/utils/streak";
import { MAX_COMPLETIONS_FETCH } from "@/lib/constants/limits";
import {
  DASHBOARD_VIEW_COOKIE,
  parseDashboardView,
  type DashboardView,
} from "@/lib/constants/dashboard-view";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function fetchHabits(supabase: SupabaseServerClient, userId: string) {
  const { data } = await supabase
    .from("habits")
    .select("id, user_id, title, description, emoji, color, frequency, schedule, time_window, streak_current, streak_best, total_completions, is_paused, is_shared, created_at")
    .eq("user_id", userId)
    .eq("is_paused", false)
    .order("created_at");
  return data ?? [];
}

/**
 * Habits and active challenges. Neither depends on the user's profile, so this
 * is started before the profile await and resolved afterwards.
 */
function fetchBaseData(supabase: SupabaseServerClient, userId: string) {
  return Promise.all([
    fetchHabits(supabase, userId),
    supabase
      .from("group_challenges")
      .select("id, title, emoji")
      .eq("is_active", true),
  ]);
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

  // The habits and challenges queries only need the user id, so start them
  // now rather than after the profile resolves — those are independent round
  // trips and awaiting the profile first serialized them for no reason.
  const supabase = await createServerSupabase();
  const baseData = fetchBaseData(supabase, user.id);
  // Nothing awaits `baseData` until <HabitsSection> renders, with `await
  // cookies()` and `await getProfile()` in between. A transport-level failure
  // in that window (DNS/TLS/socket — Postgrest query errors come back as
  // `{ error }` and don't reject) would reject with no handler attached and
  // take the process down via `unhandledRejection`. Marking it handled here
  // swallows nothing: `baseData` itself still rejects for the awaiting
  // consumer, which is where the failure should surface.
  baseData.catch(() => {});

  // Render the user's actual view server-side so there is no post-hydration
  // view swap (and therefore no lazily-loaded chunk placeholder).
  const initialView = parseDashboardView(
    (await cookies()).get(DASHBOARD_VIEW_COOKIE)?.value,
  );

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
        {/* Greeting */}
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

        {/* Resolved as part of the page. There is deliberately no nested
            Suspense here: the habits land ~190ms after the greeting, which is
            close enough that a second loading state reads as a flicker rather
            than as progress. One boundary (dashboard/loading.tsx) covers the
            whole screen, so the user perceives a single transition. */}
        <HabitsSection
          userId={user.id}
          timezone={timeZone}
          supabase={supabase}
          baseData={baseData}
          initialView={initialView}
        />
      </div>
    </div>
  );
}

/** Async Server Component — awaited by the page, behind loading.tsx. */
async function HabitsSection({
  userId,
  timezone,
  supabase,
  baseData,
  initialView,
}: {
  userId: string;
  timezone: string;
  supabase: SupabaseServerClient;
  baseData: ReturnType<typeof fetchBaseData>;
  initialView: DashboardView;
}) {
  // Already in flight since before the profile resolved.
  const [habits, { data: challenges }] = await baseData;

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
      initialView={initialView}
    />
  );
}
