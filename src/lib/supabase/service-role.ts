import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * The service-role client. It bypasses row-level security, so it is for
 * route handlers only, and only after they have established who is asking
 * and that they may: nothing in a component may import this.
 *
 * `null` when the server is missing its key, which the caller reports
 * instead of this throwing halfway through a request.
 */
export function createServiceRoleClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
