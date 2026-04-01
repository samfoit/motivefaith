import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  display_name: string;
  timezone: string;
  push_subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  } | null;
  notification_prefs: {
    quiet_start?: string;
    quiet_end?: string;
    enabled?: boolean;
  } | null;
}

interface WeeklyStats {
  totalCompletions: number;
  totalScheduled: number;
  completionRate: number;
  bestStreak: number;
  mostConsistentHabit: { title: string; emoji: string; count: number } | null;
  prevWeekCompletions: number;
  encouragementsSent: number;
  encouragementsReceived: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekBounds(now: Date): { thisStart: string; thisEnd: string; prevStart: string; prevEnd: string } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);

  // End of this week = today
  const thisEnd = d.toISOString();

  // Start of this week = 7 days ago
  const thisStartDate = new Date(d);
  thisStartDate.setDate(thisStartDate.getDate() - 6);
  const thisStart = thisStartDate.toISOString();

  // Previous week
  const prevEndDate = new Date(thisStartDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevEnd = prevEndDate.toISOString();

  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - 6);
  const prevStart = prevStartDate.toISOString();

  return { thisStart, thisEnd, prevStart, prevEnd };
}

function isSundayEvening(timezone: string): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);

    // Sunday between 17:00 and 21:00 in user's timezone
    return weekday === "Sunday" && hour >= 17 && hour <= 21;
  } catch {
    return false;
  }
}

async function sendPush(
  supabaseUrl: string,
  subscription: ProfileRow["push_subscription"],
  payload: { title: string; body: string; url: string; type: string; user_id: string },
): Promise<void> {
  if (!subscription) return;

  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        subscription,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        type: payload.type,
        user_id: payload.user_id,
      }),
    });
  } catch (err) {
    console.error("Failed to invoke send-push:", err);
  }
}

function buildSummaryBody(stats: WeeklyStats): string {
  const parts: string[] = [];

  const rate = Math.round(stats.completionRate);
  parts.push(`${rate}% completion rate`);

  if (stats.totalCompletions > 0) {
    parts.push(`${stats.totalCompletions} completions`);
  }

  if (stats.bestStreak > 0) {
    parts.push(`${stats.bestStreak}-day best streak`);
  }

  const diff = stats.totalCompletions - stats.prevWeekCompletions;
  if (diff > 0) {
    parts.push(`↑ ${diff} more than last week`);
  } else if (diff < 0) {
    parts.push(`↓ ${Math.abs(diff)} fewer than last week`);
  }

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Only allow calls from service_role (cron jobs / internal).
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  );

  // Fetch all profiles with push subscriptions
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, timezone, push_subscription, notification_prefs")
    .not("push_subscription", "is", null);

  if (profilesError) {
    console.error("Failed to fetch profiles:", profilesError);
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  // Filter to eligible profiles (Sunday evening + notifications enabled)
  const eligibleProfiles = ((profiles ?? []) as ProfileRow[]).filter(
    (p) =>
      p.push_subscription &&
      p.notification_prefs?.enabled !== false &&
      isSundayEvening(p.timezone),
  );

  if (eligibleProfiles.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const now = new Date();
  const { thisStart, thisEnd, prevStart, prevEnd } = getWeekBounds(now);

  type Completion = { user_id: string; habit_id: string };
  type Habit = { id: string; user_id: string; title: string; emoji: string; schedule: unknown; streak_current: number };

  let sent = 0;

  // Process users in chunks of 100 to prevent memory overflow at scale
  const CHUNK_SIZE = 100;
  const PUSH_BATCH_SIZE = 50;

  for (let offset = 0; offset < eligibleProfiles.length; offset += CHUNK_SIZE) {
    const chunk = eligibleProfiles.slice(offset, offset + CHUNK_SIZE);
    const userIds = chunk.map((p) => p.id);

    // Batch-fetch all data for this chunk in parallel (5 queries)
    const [
      { data: allThisWeekCompletions },
      { data: allPrevWeekCompletions },
      { data: allHabits },
      { data: allEncSent },
      { data: allEncReceived },
    ] = await Promise.all([
      supabase
        .from("completions")
        .select("user_id, habit_id")
        .in("user_id", userIds)
        .gte("completed_at", thisStart)
        .lte("completed_at", thisEnd),
      supabase
        .from("completions")
        .select("user_id")
        .in("user_id", userIds)
        .gte("completed_at", prevStart)
        .lte("completed_at", prevEnd),
      supabase
        .from("habits")
        .select("id, user_id, title, emoji, schedule, streak_current")
        .in("user_id", userIds)
        .eq("is_paused", false),
      supabase
        .from("encouragements")
        .select("user_id")
        .in("user_id", userIds)
        .gte("created_at", thisStart)
        .lte("created_at", thisEnd),
      supabase
        .from("encouragements")
        .select("recipient_id")
        .in("recipient_id", userIds)
        .gte("created_at", thisStart)
        .lte("created_at", thisEnd),
    ]);

    // Index all data by user_id for O(1) lookup
    const thisWeekByUser = new Map<string, Completion[]>();
    for (const c of (allThisWeekCompletions ?? []) as Completion[]) {
      const list = thisWeekByUser.get(c.user_id) ?? [];
      list.push(c);
      thisWeekByUser.set(c.user_id, list);
    }

    const prevWeekCountByUser = new Map<string, number>();
    for (const c of (allPrevWeekCompletions ?? []) as { user_id: string }[]) {
      prevWeekCountByUser.set(c.user_id, (prevWeekCountByUser.get(c.user_id) ?? 0) + 1);
    }

    const habitsByUser = new Map<string, Habit[]>();
    for (const h of (allHabits ?? []) as Habit[]) {
      const list = habitsByUser.get(h.user_id) ?? [];
      list.push(h);
      habitsByUser.set(h.user_id, list);
    }

    const encSentByUser = new Map<string, number>();
    for (const e of (allEncSent ?? []) as { user_id: string }[]) {
      encSentByUser.set(e.user_id, (encSentByUser.get(e.user_id) ?? 0) + 1);
    }

    const encReceivedByUser = new Map<string, number>();
    for (const e of (allEncReceived ?? []) as { recipient_id: string }[]) {
      encReceivedByUser.set(e.recipient_id, (encReceivedByUser.get(e.recipient_id) ?? 0) + 1);
    }

    // Compute stats and collect push tasks for this chunk
    const pushTasks: Array<() => Promise<void>> = [];

    for (const profile of chunk) {
      const thisWeekCompletions = thisWeekByUser.get(profile.id) ?? [];
      const habits = habitsByUser.get(profile.id) ?? [];

      let totalScheduled = 0;
      for (const habit of habits) {
        const schedule = habit.schedule as { days?: number[] } | null;
        const days = schedule?.days ?? [0, 1, 2, 3, 4, 5, 6];
        totalScheduled += days.length;
      }

      const totalCompletions = thisWeekCompletions.length;
      const completionRate = totalScheduled > 0
        ? (totalCompletions / totalScheduled) * 100
        : 0;

      const habitCounts = new Map<string, number>();
      for (const c of thisWeekCompletions) {
        habitCounts.set(c.habit_id, (habitCounts.get(c.habit_id) ?? 0) + 1);
      }

      const habitMap = new Map(habits.map((h) => [h.id, h]));

      let mostConsistentHabit: WeeklyStats["mostConsistentHabit"] = null;
      let maxCount = 0;
      for (const [habitId, count] of habitCounts) {
        if (count > maxCount) {
          maxCount = count;
          const habit = habitMap.get(habitId);
          if (habit) {
            mostConsistentHabit = {
              title: habit.title,
              emoji: habit.emoji,
              count,
            };
          }
        }
      }

      const bestStreak = Math.max(
        0,
        ...habits.map((h) => h.streak_current),
      );

      const stats: WeeklyStats = {
        totalCompletions,
        totalScheduled,
        completionRate,
        bestStreak,
        mostConsistentHabit,
        prevWeekCompletions: prevWeekCountByUser.get(profile.id) ?? 0,
        encouragementsSent: encSentByUser.get(profile.id) ?? 0,
        encouragementsReceived: encReceivedByUser.get(profile.id) ?? 0,
      };

      const body = buildSummaryBody(stats);

      pushTasks.push(() =>
        sendPush(supabaseUrl, profile.push_subscription, {
          title: "📊 Your Weekly Summary",
          body,
          url: "/main/dashboard/weekly",
          type: "weekly_summary",
          user_id: profile.id,
        }),
      );
    }

    // Send push notifications in batches of 50
    for (let i = 0; i < pushTasks.length; i += PUSH_BATCH_SIZE) {
      const batch = pushTasks.slice(i, i + PUSH_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((fn) => fn()));
      sent += results.filter((r) => r.status === "fulfilled").length;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
