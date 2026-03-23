import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MissedHabit {
  id: string;
  title: string;
  emoji: string;
  user_id: string;
  user_name: string;
}

interface ShareRow {
  habit_id: string;
  shared_with: string;
  profiles: {
    push_subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    } | null;
    notification_prefs: {
      quiet_start?: string; // "HH:MM"
      quiet_end?: string; // "HH:MM"
      enabled?: boolean;
    } | null;
    timezone: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInQuietHours(
  prefs: ShareRow["profiles"]["notification_prefs"],
  timezone: string,
): boolean {
  if (!prefs?.quiet_start || !prefs?.quiet_end) return false;

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    });
    const currentTime = formatter.format(now); // "HH:MM"

    const start = prefs.quiet_start;
    const end = prefs.quiet_end;

    // Handle overnight quiet hours (e.g. 22:00 - 07:00)
    if (start > end) {
      return currentTime >= start || currentTime < end;
    }

    return currentTime >= start && currentTime < end;
  } catch {
    return false;
  }
}

async function sendPush(
  supabaseUrl: string,
  subscription: ShareRow["profiles"]["push_subscription"],
  payload: { title: string; body: string; url: string; type: string; user_id?: string },
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

  // Pass the current UTC timestamp — the RPC uses each user's timezone
  // to determine their local date/time, so we only get habits where the
  // time window has actually closed in the user's local timezone.
  const { data: missedHabits, error } = await supabase.rpc("get_missed_habits", {
    check_ts: new Date().toISOString(),
  });

  if (error) {
    console.error("get_missed_habits RPC error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const habits = (missedHabits ?? []) as MissedHabit[];
  if (habits.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, checked: 0, sent: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Batch-fetch all shares for all missed habits in a single query
  const habitIds = habits.map((h) => h.id);
  const { data: allShares } = await supabase
    .from("habit_shares")
    .select(
      "habit_id, shared_with, profiles!shared_with(push_subscription, notification_prefs, timezone)",
    )
    .in("habit_id", habitIds)
    .eq("notify_miss", true);

  // Group shares by habit_id for O(1) lookup
  const sharesByHabit = new Map<string, ShareRow[]>();
  for (const share of (allShares ?? []) as unknown as ShareRow[]) {
    const existing = sharesByHabit.get(share.habit_id) ?? [];
    existing.push(share);
    sharesByHabit.set(share.habit_id, existing);
  }

  // Collect all push payloads, then send in batches
  const pushTasks: Array<() => Promise<void>> = [];

  for (const habit of habits) {
    const shares = sharesByHabit.get(habit.id) ?? [];

    for (const share of shares) {
      const { profiles: profile } = share;

      // Skip if notifications are disabled
      if (profile.notification_prefs?.enabled === false) continue;

      // Skip if no push subscription
      if (!profile.push_subscription) continue;

      // Skip if in quiet hours
      if (isInQuietHours(profile.notification_prefs, profile.timezone)) continue;

      pushTasks.push(() =>
        sendPush(supabaseUrl, profile.push_subscription, {
          title: `${habit.emoji} ${habit.user_name} missed ${habit.title}`,
          body: "Send some encouragement!",
          url: `/main/feed/${habit.user_id}`,
          type: "missed_habit",
          user_id: share.shared_with,
        }),
      );
    }
  }

  // Send in batches of 50 concurrent requests
  const BATCH_SIZE = 50;
  let sent = 0;
  for (let i = 0; i < pushTasks.length; i += BATCH_SIZE) {
    const batch = pushTasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((fn) => fn()));
    sent += results.filter((r) => r.status === "fulfilled").length;
  }

  return new Response(
    JSON.stringify({ ok: true, checked: habits.length, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
