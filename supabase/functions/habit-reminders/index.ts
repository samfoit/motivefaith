import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HabitDue {
  id: string;
  title: string;
  emoji: string;
  user_id: string;
  push_subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  } | null;
  notification_prefs: {
    quiet_start?: string;
    quiet_end?: string;
    enabled?: boolean;
    habit_reminders?: boolean;
  } | null;
  timezone: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInQuietHours(
  prefs: HabitDue["notification_prefs"],
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
  subscription: HabitDue["push_subscription"],
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
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: habits, error } = await supabase.rpc("get_habits_due_for_reminder", {
    check_ts: new Date().toISOString(),
  });

  if (error) {
    console.error("get_habits_due_for_reminder RPC error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const dueHabits = (habits ?? []) as HabitDue[];
  if (dueHabits.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, checked: 0, sent: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Collect push tasks, respecting quiet hours
  const pushTasks: Array<{ habitId: string; userId: string; fn: () => Promise<void> }> = [];

  for (const habit of dueHabits) {
    if (!habit.push_subscription) continue;
    if (isInQuietHours(habit.notification_prefs, habit.timezone)) continue;

    pushTasks.push({
      habitId: habit.id,
      userId: habit.user_id,
      fn: () =>
        sendPush(supabaseUrl, habit.push_subscription, {
          title: `${habit.emoji} Time for ${habit.title}`,
          body: "Tap to log your completion",
          url: "/main/dashboard",
          type: "habit_reminder",
          user_id: habit.user_id,
        }),
    });
  }

  // Send in batches of 50 concurrent requests, tracking which succeeded
  const BATCH_SIZE = 50;
  let sent = 0;
  const sentHabitIds: string[] = [];

  for (let i = 0; i < pushTasks.length; i += BATCH_SIZE) {
    const batch = pushTasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((t) => t.fn()));
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        sent++;
        sentHabitIds.push(batch[j].habitId);
      }
    }
  }

  // Update last_reminder_date only for successfully sent habits
  if (sentHabitIds.length > 0) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await supabase
      .from("habits")
      .update({ last_reminder_date: today })
      .in("id", sentHabitIds);
  }

  return new Response(
    JSON.stringify({ ok: true, checked: dueHabits.length, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
