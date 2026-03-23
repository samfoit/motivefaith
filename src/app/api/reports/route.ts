import { verifyCsrf } from "@/lib/utils/csrf";
import { jsonResponse, requireAuthUser, parseRequestBody } from "@/lib/utils/api-helpers";
import { VALID_CONTENT_TYPES, VALID_REASONS } from "@/lib/constants/reports";
import { UUID_RE } from "@/lib/constants/validation";
import type { Database } from "@/lib/supabase/types";

type ReportReason = Database["public"]["Enums"]["report_reason"];

/** Max reports per user within the rate limit window. */
const RATE_LIMIT = 5;
/** Rate limit window in seconds (1 hour). */
const RATE_WINDOW_SECONDS = 3600;

const MAX_DESCRIPTION_LENGTH = 2000;

/** Reject bodies larger than 16 KB. */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // Rate limit: 5 reports per hour
  const windowStart = new Date(
    Date.now() - RATE_WINDOW_SECONDS * 1000,
  ).toISOString();

  const { count, error: countError } = await supabase
    .from("content_reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", user.id)
    .gte("created_at", windowStart);

  if (countError) {
    return jsonResponse({ error: "Rate check failed" }, { status: 500 });
  }

  if ((count ?? 0) >= RATE_LIMIT) {
    return jsonResponse(
      { error: "Too many reports. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(RATE_WINDOW_SECONDS) },
      },
    );
  }

  const parsed = await parseRequestBody(request, MAX_BODY_BYTES);
  if (parsed.error) return parsed.error;
  const body = parsed.data as Record<string, unknown>;

  const { contentType, contentId, reason, description } = body;

  if (
    typeof contentType !== "string" ||
    !VALID_CONTENT_TYPES.has(contentType)
  ) {
    return jsonResponse(
      { error: "contentType must be one of: completion, message, profile, group" },
      { status: 400 },
    );
  }

  if (typeof contentId !== "string" || !UUID_RE.test(contentId)) {
    return jsonResponse(
      { error: "contentId must be a valid UUID" },
      { status: 400 },
    );
  }

  if (typeof reason !== "string" || !VALID_REASONS.has(reason)) {
    return jsonResponse(
      { error: "reason must be one of: illegal, csam, intimate_imagery, copyright, harassment, spam, other" },
      { status: 400 },
    );
  }

  if (
    description !== undefined &&
    description !== null &&
    (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    return jsonResponse(
      { error: `description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("content_reports")
    .insert({
      reporter_id: user.id,
      content_type: contentType,
      content_id: contentId,
      reason: reason as ReportReason,
      description: (description as string) || null,
    })
    .select("id, created_at")
    .single();

  if (error) {
    console.error("Report insert failed:", error.code ?? "unknown");
    return jsonResponse(
      { error: "Failed to submit report" },
      { status: 500 },
    );
  }

  return jsonResponse(data, { status: 201 });
}
