import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One partner to tell about one missed habit. get_missed_habits (045, 048)
 * has already chosen them: an accepted partner who wants miss alerts, has a
 * device to push to, is outside their quiet hours and has not been told
 * about this day yet.
 */
interface MissedAlert {
  share_id: string;
  habit_id: string;
  title: string;
  emoji: string | null;
  user_id: string;
  user_name: string;
  partner_id: string;
  /** The owner's local date of the missed day, as YYYY-MM-DD. */
  owner_date: string;
  /**
   * The owner's local date when this run asked, as YYYY-MM-DD. Later than
   * owner_date for a window that closed late yesterday, or one a partner's
   * quiet hours held back overnight. Absent before 048.
   */
  owner_today?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * The push's title: "🏃 Olive missed Run", and "… yesterday" when the day
 * missed is no longer the owner's today. A habit can have no emoji; it is
 * left out rather than pushed as "null".
 */
function missedTitle(alert: MissedAlert): string {
  const when = alert.owner_today && alert.owner_date < alert.owner_today ? " yesterday" : "";
  return `${alert.emoji ? `${alert.emoji} ` : ""}${alert.user_name} missed ${alert.title}${when}`;
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

  // Pass the current UTC timestamp — the RPC uses each owner's timezone to
  // find their day, and that day's own window, so a habit is only missed
  // once its window has closed where its owner is. It looks back to the
  // owner's yesterday too, for a window that closed after the last run of
  // the day, or a partner who was in quiet hours when it did.
  const { data: rows, error } = await supabase.rpc("get_missed_habits", {
    check_ts: new Date().toISOString(),
  });

  if (error) {
    console.error("get_missed_habits RPC error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const alerts = (rows ?? []) as MissedAlert[];
  if (alerts.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, checked: 0, sent: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Send in batches of 50 concurrent requests, tracking which were delivered.
  // A failed push is neither counted nor recorded, so the next run tries again.
  const BATCH_SIZE = 50;
  let sent = 0;
  // Delivered shares, grouped by the owner's date of the missed day
  const sentByDate = new Map<string, string[]>();

  for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
    const batch = alerts.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((alert) =>
        sendPush(supabaseUrl, {
          title: missedTitle(alert),
          body: "Send some encouragement!",
          url: `/main/feed/${alert.user_id}`,
          type: "missed_habit",
          user_id: alert.partner_id,
        }),
      ),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        sent++;
        const { owner_date: date, share_id: shareId } = batch[j];
        sentByDate.set(date, [...(sentByDate.get(date) ?? []), shareId]);
      }
    }
  }

  // Each partner hears about a missed day once: the RPC skips a share
  // already told about that date.
  for (const [date, shareIds] of sentByDate) {
    await supabase
      .from("habit_shares")
      .update({ last_miss_alert_date: date })
      .in("id", shareIds);
  }

  return new Response(
    JSON.stringify({ ok: true, checked: alerts.length, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
