import { requireAdmin } from "@/lib/utils/admin";
import { verifyCsrf } from "@/lib/utils/csrf";
import { jsonResponse } from "@/lib/utils/api-helpers";
import { VALID_CONTENT_TYPES, VALID_REASONS } from "@/lib/constants/reports";
import { UUID_RE } from "@/lib/constants/validation";
import type { Tables, TablesUpdate, Enums } from "@/lib/supabase/types";

/**
 * Extends the generated Row type with reviewed_by (added in migration 026).
 * TODO: Remove after regenerating Supabase types.
 */
type ContentReportRow = Tables<"content_reports"> & {
  reviewed_by: string | null;
};

type ReporterProfile = Pick<
  Tables<"profiles">,
  "id" | "display_name" | "username" | "avatar_url"
>;

const VALID_STATUSES = new Set<string>([
  "pending",
  "reviewed",
  "actioned",
  "dismissed",
]);

/**
 * GET /api/admin/reports — List reports with optional filters.
 *
 * Query params: status, reason, contentType, page (default 0), limit (default 20, max 100)
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { supabase } = admin;
  const url = new URL(request.url);

  const status = url.searchParams.get("status");
  const reason = url.searchParams.get("reason");
  const contentType = url.searchParams.get("contentType");
  const page = Math.max(
    0,
    parseInt(url.searchParams.get("page") ?? "0", 10) || 0,
  );
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );
  const from = page * limit;
  const to = from + limit - 1;

  // select("*") returns all typed columns; reviewed_by is included at runtime.
  let query = supabase
    .from("content_reports")
    .select("*", { count: "exact" });

  if (status && VALID_STATUSES.has(status)) {
    query = query.eq("status", status as Enums<"report_status">);
  }
  if (reason && VALID_REASONS.has(reason)) {
    query = query.eq("reason", reason as Enums<"report_reason">);
  }
  if (contentType && VALID_CONTENT_TYPES.has(contentType)) {
    query = query.eq("content_type", contentType);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    console.error("Admin reports fetch failed:", error.message);
    return jsonResponse({ error: "Failed to fetch reports" }, { status: 500 });
  }

  // Cast to include reviewed_by (migration 026, not in generated types)
  const reports = data as ContentReportRow[] | null;

  if (!reports || reports.length === 0) {
    return jsonResponse({ reports: [], total: 0, page, limit });
  }

  // Batch-fetch reporter profiles
  const reporterIds = [...new Set(reports.map((r) => r.reporter_id))];
  const { data: reporters } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", reporterIds);

  const reporterMap = new Map<string, ReporterProfile>(
    (reporters ?? []).map((p) => [p.id, p]),
  );

  // Batch-fetch content details
  const completionIds = reports
    .filter((r) => r.content_type === "completion")
    .map((r) => r.content_id);
  const messageIds = reports
    .filter((r) => r.content_type === "message")
    .map((r) => r.content_id);

  const [completionsResult, messagesResult] = await Promise.all([
    completionIds.length > 0
      ? supabase
          .from("completions")
          .select(
            "id, notes, evidence_url, completed_at, habit_id, habits(title, emoji)",
          )
          .in("id", completionIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
    messageIds.length > 0
      ? supabase
          .from("group_messages")
          .select("id, content, created_at, group_id, groups(name)")
          .in("id", messageIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const completionMap = new Map(
    (completionsResult.data ?? []).map((c) => [c.id, c]),
  );
  const messageMap = new Map(
    (messagesResult.data ?? []).map((m) => [m.id, m]),
  );

  const enriched = reports.map((r) => ({
    ...r,
    reporter: reporterMap.get(r.reporter_id) ?? null,
    content:
      r.content_type === "completion"
        ? (completionMap.get(r.content_id) ?? null)
        : r.content_type === "message"
          ? (messageMap.get(r.content_id) ?? null)
          : null,
  }));

  return jsonResponse({ reports: enriched, total: count ?? 0, page, limit });
}

/**
 * PATCH /api/admin/reports — Update a report's status.
 *
 * Body: { reportId, status, reviewerNotes? }
 */
export async function PATCH(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { userId, supabase } = admin;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { reportId, status, reviewerNotes } = body;

  if (typeof reportId !== "string" || !UUID_RE.test(reportId)) {
    return jsonResponse(
      { error: "reportId must be a valid UUID" },
      { status: 400 },
    );
  }

  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return jsonResponse(
      {
        error: "status must be one of: pending, reviewed, actioned, dismissed",
      },
      { status: 400 },
    );
  }

  if (
    reviewerNotes !== undefined &&
    reviewerNotes !== null &&
    typeof reviewerNotes !== "string"
  ) {
    return jsonResponse(
      { error: "reviewerNotes must be a string" },
      { status: 400 },
    );
  }

  // reviewed_by (migration 026) is not in generated types — cast update payload
  const { data, error } = await supabase
    .from("content_reports")
    .update({
      status: status as Enums<"report_status">,
      reviewer_notes: typeof reviewerNotes === "string" ? reviewerNotes : null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    } as TablesUpdate<"content_reports">)
    .eq("id", reportId)
    .select("id, status, reviewed_at")
    .single();

  if (error) {
    console.error("Admin report update failed:", error.message);
    return jsonResponse({ error: "Failed to update report" }, { status: 500 });
  }

  return jsonResponse(data);
}
