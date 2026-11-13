import { createClient } from "@supabase/supabase-js";
import { forbidden, isInternalCaller } from "../_shared/internal-caller.ts";
import { purgeQueuedMedia } from "./purge.ts";

/**
 * Removes from storage the files media_purge_queue lists: what a deleted
 * habit, group, account or reported check-in left behind (migration 056).
 * Cron calls it hourly, by way of invoke_edge_function() (055).
 */
Deno.serve(async (req) => {
  // Only this project's own machinery calls this. The gateway checks nothing
  // (verify_jwt is off), so the caller's key is checked here. See
  // _shared/internal-caller.ts.
  if (!(await isInternalCaller(req, Deno.env))) return forbidden();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const result = await purgeQueuedMedia(supabase);
    return new Response(JSON.stringify({ ok: result.failed === 0, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("purge-media failed:", err);
    return new Response(JSON.stringify({ error: "Purge failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
