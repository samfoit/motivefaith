import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HabitDue {
  id: string;
  title: string;
  emoji: string;
  user_id: string;
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

/**
 * Today's date (YYYY-MM-DD) in the given timezone — the same local date
 * get_habits_due_for_reminder compares last_reminder_date against.
 */
function localDateKey(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Invoke send-push; resolves true only when the push was delivered. */
async function sendPush(
  supabaseUrl: string,
  payload: { title: string; body: string; url: string; type: string; user_id: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url,
        type: payload.type,
        user_id: payload.user_id,
      }),
    });
    if (!res.ok) {
      console.error(`send-push failed (${res.status}): ${await res.text()}`);
    }
    return res.ok;
  } catch (err) {
    console.error("Failed to invoke send-push:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Edge Function handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  // Only allow calls from service_role (cron jobs / internal).
  // Supabase gateway validates the JWT and forwards it in the Authorization header.
  // When called via pg_net the gateway may strip the header, so we also accept
  // requests where the gateway already verified a service_role JWT.
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const token = authHeader.replace("Bearer ", "");
      const payloadB64 = token.split(".")[1];
      const payload = JSON.parse(atob(payloadB64));
      if (payload.role !== "service_role") {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  } else {
    const ua = req.headers.get("User-Agent") ?? "";
    if (!ua.startsWith("pg_net/")) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
  const pushTasks: Array<{
    habitId: string;
    timezone: string;
    fn: () => Promise<boolean>;
  }> = [];

  for (const habit of dueHabits) {
    if (isInQuietHours(habit.notification_prefs, habit.timezone)) continue;

    pushTasks.push({
      habitId: habit.id,
      timezone: habit.timezone,
      fn: () =>
        sendPush(supabaseUrl, {
          title: `${habit.emoji} Time for ${habit.title}`,
          body: "Tap to log your completion",
          url: "/main/dashboard",
          type: "habit_reminder",
          user_id: habit.user_id,
        }),
    });
  }

  // Send in batches of 50 concurrent requests, tracking which were delivered.
  // A failed push is neither counted nor recorded in last_reminder_date.
  const BATCH_SIZE = 50;
  let sent = 0;
  // Delivered habit IDs, grouped by their owner's local date
  const sentByDate = new Map<string, string[]>();

  for (let i = 0; i < pushTasks.length; i += BATCH_SIZE) {
    const batch = pushTasks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((t) => t.fn()));
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        sent++;
        const date = localDateKey(batch[j].timezone);
        sentByDate.set(date, [...(sentByDate.get(date) ?? []), batch[j].habitId]);
      }
    }
  }

  // Record the reminder under the user's local date, not UTC — the RPC
  // dedups against the local date, so a UTC date that has already rolled
  // over (evenings in the Americas) would suppress the next day's reminder.
  for (const [date, habitIds] of sentByDate) {
    await supabase
      .from("habits")
      .update({ last_reminder_date: date })
      .in("id", habitIds);
  }

  return new Response(
    JSON.stringify({ ok: true, checked: dueHabits.length, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
