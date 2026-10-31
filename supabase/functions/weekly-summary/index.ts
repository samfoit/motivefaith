import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  display_name: string;
  timezone: string;
  notification_prefs: {
    quiet_start?: string;
    quiet_end?: string;
    enabled?: boolean;
  } | null;
  last_weekly_summary_date: string | null;
}

/** The columns of a saved week (migration 051) the push reads. */
interface WeeklyReviewRow {
  user_id: string;
  week_start: string;
  due: number;
  done: number;
  completions: number;
  best_streak: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A YYYY-MM-DD date moved by whole days. */
function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function getLocalSundayInfo(
  timezone: string,
): { isSundayEveningHour: boolean; localDate: string } | null {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      weekday: "long",
      hour: "numeric",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!year || !month || !day) return null;

    // Single-hour window — combined with the dedup column this guarantees
    // exactly one send per user per Sunday.
    const isSundayEveningHour = weekday === "Sunday" && hour === 18;
    return { isSundayEveningHour, localDate: `${year}-${month}-${day}` };
  } catch {
    return null;
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

/** The push body, or null when the week has nothing to tell. */
function buildSummaryBody(week: WeeklyReviewRow, prev: WeeklyReviewRow | undefined): string | null {
  if (week.due === 0 && week.completions === 0) return null;

  const parts: string[] = [];

  if (week.due > 0) {
    parts.push(`${Math.round((week.done / week.due) * 100)}% completion rate`);
  }

  if (week.completions > 0) {
    parts.push(`${week.completions} completions`);
  }

  if (week.best_streak) {
    parts.push(`${week.best_streak} best streak`);
  }

  if (prev) {
    const diff = week.completions - prev.completions;
    if (diff > 0) {
      parts.push(`↑ ${diff} more than last week`);
    } else if (diff < 0) {
      parts.push(`↓ ${Math.abs(diff)} fewer than last week`);
    }
  }

  return parts.join(" · ");
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
  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  );

  // Fetch all profiles with at least one push subscription (the inner join
  // drops the rest; send-push loads the devices itself)
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, timezone, notification_prefs, last_weekly_summary_date, push_subscriptions!inner(endpoint)");

  if (profilesError) {
    console.error("Failed to fetch profiles:", profilesError);
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 });
  }

  // Filter to eligible profiles: notifications enabled, currently in the
  // single-hour Sunday window, and not already sent today.
  const eligible: Array<{ profile: ProfileRow; localDate: string }> = [];
  for (const profile of (profiles ?? []) as ProfileRow[]) {
    if (profile.notification_prefs?.enabled === false) continue;
    const info = getLocalSundayInfo(profile.timezone);
    if (!info || !info.isSundayEveningHour) continue;
    if (profile.last_weekly_summary_date === info.localDate) continue;
    eligible.push({ profile, localDate: info.localDate });
  }

  if (eligible.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  let sent = 0;

  // Process users in chunks of 100 to keep the .in() lists short
  const CHUNK_SIZE = 100;
  const PUSH_BATCH_SIZE = 50;

  for (let offset = 0; offset < eligible.length; offset += CHUNK_SIZE) {
    const chunk = eligible.slice(offset, offset + CHUNK_SIZE);

    // The week that ended yesterday, Saturday, and the one before it, as
    // save_weekly_reviews() saved them early this Sunday.
    const weekStarts = new Set<string>();
    for (const { localDate } of chunk) {
      weekStarts.add(addDays(localDate, -7));
      weekStarts.add(addDays(localDate, -14));
    }

    const { data: reviews, error: reviewsError } = await supabase
      .from("weekly_reviews")
      .select("user_id, week_start, due, done, completions, best_streak")
      .in("user_id", chunk.map((e) => e.profile.id))
      .in("week_start", [...weekStarts]);

    if (reviewsError) {
      console.error("Failed to fetch weekly reviews:", reviewsError);
      continue;
    }

    const reviewByKey = new Map<string, WeeklyReviewRow>();
    for (const r of (reviews ?? []) as WeeklyReviewRow[]) {
      reviewByKey.set(`${r.user_id}:${r.week_start}`, r);
    }

    const pushTasks: Array<{ userId: string; localDate: string; run: () => Promise<boolean> }> = [];

    for (const { profile, localDate } of chunk) {
      const week = reviewByKey.get(`${profile.id}:${addDays(localDate, -7)}`);
      // No saved week: no habit in it, so nothing to tell.
      if (!week) continue;

      const body = buildSummaryBody(week, reviewByKey.get(`${profile.id}:${addDays(localDate, -14)}`));
      if (!body) continue;

      pushTasks.push({
        userId: profile.id,
        localDate,
        run: () =>
          sendPush(supabaseUrl, {
            title: "📊 Your Weekly Summary",
            body,
            url: `/main/dashboard/weekly/${week.week_start}`,
            type: "weekly_summary",
            user_id: profile.id,
          }),
      });
    }

    // Send push notifications in batches of 50, then stamp
    // last_weekly_summary_date for each profile whose push succeeded so we
    // don't re-send on a subsequent cron tick.
    const sentUserIdsByDate = new Map<string, string[]>();
    for (let i = 0; i < pushTasks.length; i += PUSH_BATCH_SIZE) {
      const batch = pushTasks.slice(i, i + PUSH_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((t) => t.run()));
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status !== "fulfilled" || !result.value) continue;
        sent += 1;
        const { userId, localDate } = batch[j];
        const list = sentUserIdsByDate.get(localDate) ?? [];
        list.push(userId);
        sentUserIdsByDate.set(localDate, list);
      }
    }

    for (const [localDate, userIds] of sentUserIdsByDate) {
      const { error } = await supabase
        .from("profiles")
        .update({ last_weekly_summary_date: localDate })
        .in("id", userIds);
      if (error) {
        console.error("Failed to stamp last_weekly_summary_date:", error);
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
