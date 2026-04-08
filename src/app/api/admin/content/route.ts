import { requireAdmin } from "@/lib/utils/admin";
import { verifyCsrf } from "@/lib/utils/csrf";
import { jsonResponse } from "@/lib/utils/api-helpers";
import { UUID_RE } from "@/lib/constants/validation";

const DELETABLE_TYPES = new Set(["completion", "message"]);

/**
 * DELETE /api/admin/content — Delete reported content and mark report as actioned.
 *
 * Body: { reportId, contentType, contentId, reviewerNotes? }
 */
export async function DELETE(request: Request) {
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

  const { reportId, contentType, contentId, reviewerNotes } = body;

  if (typeof reportId !== "string" || !UUID_RE.test(reportId)) {
    return jsonResponse(
      { error: "reportId must be a valid UUID" },
      { status: 400 },
    );
  }

  if (typeof contentType !== "string" || !DELETABLE_TYPES.has(contentType)) {
    return jsonResponse(
      { error: "contentType must be one of: completion, message" },
      { status: 400 },
    );
  }

  if (typeof contentId !== "string" || !UUID_RE.test(contentId)) {
    return jsonResponse(
      { error: "contentId must be a valid UUID" },
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

  // Delete the content (cascades handle reactions automatically)
  const { error: deleteError } =
    contentType === "completion"
      ? await supabase.from("completions").delete().eq("id", contentId)
      : await supabase.from("group_messages").delete().eq("id", contentId);

  if (deleteError) {
    console.error("Admin content delete failed:", deleteError.message);
    return jsonResponse({ error: "Failed to delete content" }, { status: 500 });
  }

  // Mark report as actioned
  const { error: updateError } = await supabase
    .from("content_reports")
    .update({
      status: "actioned" as const,
      reviewer_notes: (reviewerNotes as string) || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    })
    .eq("id", reportId);

  if (updateError) {
    console.error("Admin report action update failed:", updateError.message);
    // Content was deleted but report status could not be updated.
    // Return success for the delete but surface a warning so the
    // admin knows the report record needs manual attention.
    return jsonResponse({
      deleted: true,
      reportId,
      contentId,
      warning: "Content deleted but report status update failed",
    });
  }

  return jsonResponse({ deleted: true, reportId, contentId });
}
