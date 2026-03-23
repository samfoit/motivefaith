/**
 * Database-backed sliding-window rate limiter for server-side use.
 *
 * Uses the Supabase database to track request counts per user, which
 * survives serverless cold starts and works correctly across multiple
 * Vercel regions / function instances.
 *
 * For client-side (UX) rate limiting, see rate-limit-client.ts.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type TableName = keyof Database["public"]["Tables"];

interface RateLimiterOptions {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Window size in seconds. */
  windowSeconds: number;
  /**
   * Supabase table name to count against.
   * The table must have a user-scoped column and a `created_at` column.
   */
  table: TableName;
  /** Column name that holds the user identifier (default: "reporter_id"). */
  userColumn?: string;
}

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Check whether `userId` has exceeded the rate limit for the given table.
 *
 * This performs a COUNT query against the database, which is consistent
 * across all serverless instances and survives cold starts.
 */
export async function checkRateLimit(
  userId: string,
  options: RateLimiterOptions,
): Promise<RateLimitResult> {
  const { limit, windowSeconds, table, userColumn = "reporter_id" } = options;

  const supabase = await createServerSupabase();
  const windowStart = new Date(
    Date.now() - windowSeconds * 1000,
  ).toISOString();

  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(userColumn, userId)
    .gte("created_at", windowStart);

  if (error) {
    // Fail open but log — a transient DB error shouldn't block the user,
    // but we want visibility.
    console.error(`[rate-limit] count query failed on ${table}:`, error.code);
    return { allowed: true };
  }

  if ((count ?? 0) >= limit) {
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }

  return { allowed: true };
}
