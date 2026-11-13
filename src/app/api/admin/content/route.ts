import { requireAdmin } from "@/lib/utils/admin";
import { verifyCsrf } from "@/lib/utils/csrf";
import { jsonResponse } from "@/lib/utils/api-helpers";
import { UUID_RE } from "@/lib/constants/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { removeStoredFiles, storagePathOf } from "@/lib/utils/storage-cleanup";

const DELETABLE_TYPES = new Set(["completion", "message"]);

/** Check-in and capture media all live in this one private bucket. */
const MEDIA_BUCKET = "completions";

/**
 * DELETE /api/admin/content — Take reported content down and mark the report
 * as actioned.
 *
 * Body: { reportId, contentType, contentId, reviewerNotes? }
 *
 * Done as the service role, once the caller is known to be an admin. A
 * moderator's own session only reaches content they could already see: the
 * admin delete policies let them delete a row, but nothing lets them read
 * one, and a delete cannot remove a row it cannot find. So for anyone they
 * were not partnered or grouped with, the delete removed nothing, reported
 * no error, and the report was marked actioned over content still in place.
 *
 * The media goes first, then the row:
 *
 *   - If storage refuses, nothing has changed and the moderator can try
 *     again. The other way round, the row would be gone and with it the
 *     only record of which file to remove.
 *   - The file is removed outright, even if the same capture was also sent
 *     to a friend or a group. Taking it down means it is gone everywhere it
 *     was shown; those rows stay, without their media.
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

  const service = createServiceRoleClient();
  if (!service) {
    console.error("[api/admin/content] Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
    return jsonResponse({ error: "Server misconfigured" }, { status: 500 });
  }

  // The service role can delete anything, so what it deletes is pinned to
  // the report: this content, and only because someone reported it.
  const { data: report, error: reportError } = await service
    .from("content_reports")
    .select("id, content_type, content_id")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) {
    console.error("Admin content report lookup failed:", reportError.message);
    return jsonResponse({ error: "Failed to delete content" }, { status: 500 });
  }
  if (!report || report.content_type !== contentType || report.content_id !== contentId) {
    return jsonResponse(
      { error: "No report matches this content" },
      { status: 404 },
    );
  }

  // The content's author and the files it shows. A check-in kept private
  // holds its media in a table of its own, which goes with the check-in.
  let authorId: string | null = null;
  let references: (string | null)[] = [];

  if (contentType === "completion") {
    const [completion, privateContent] = await Promise.all([
      service
        .from("completions")
        .select("user_id, evidence_url")
        .eq("id", contentId)
        .maybeSingle(),
      service
        .from("completion_private_content")
        .select("evidence_url")
        .eq("completion_id", contentId)
        .maybeSingle(),
    ]);
    if (completion.error || privateContent.error) {
      console.error(
        "Admin content lookup failed:",
        (completion.error ?? privateContent.error)?.message,
      );
      return jsonResponse({ error: "Failed to delete content" }, { status: 500 });
    }
    authorId = completion.data?.user_id ?? null;
    references = [completion.data?.evidence_url ?? null, privateContent.data?.evidence_url ?? null];
  } else {
    const message = await service
      .from("group_messages")
      .select("user_id, media_path")
      .eq("id", contentId)
      .maybeSingle();
    if (message.error) {
      console.error("Admin content lookup failed:", message.error.message);
      return jsonResponse({ error: "Failed to delete content" }, { status: 500 });
    }
    authorId = message.data?.user_id ?? null;
    references = [message.data?.media_path ?? null];
  }

  // Only files in the author's own folder. A row can hold any text as its
  // path; one naming somebody else's file is no reason to remove theirs.
  const mediaPaths = [
    ...new Set(
      references
        .map(storagePathOf)
        .filter((path): path is string => path !== null)
        .filter((path) => authorId !== null && path.toLowerCase().startsWith(`${authorId}/`)),
    ),
  ];

  if (mediaPaths.length > 0) {
    try {
      await removeStoredFiles(service.storage, MEDIA_BUCKET, mediaPaths);
    } catch (err) {
      console.error("Admin content media removal failed:", err);
      return jsonResponse(
        { error: "Failed to remove the content's media. Nothing was deleted." },
        { status: 500 },
      );
    }
  }

  // Then the row (cascades handle reactions automatically). When it is
  // already gone — the author deleted it first — there is nothing left to
  // remove and the report is closed all the same.
  const { error: deleteError } =
    contentType === "completion"
      ? await service.from("completions").delete().eq("id", contentId)
      : await service.from("group_messages").delete().eq("id", contentId);

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
