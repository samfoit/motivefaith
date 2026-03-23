import { verifyCsrf } from "@/lib/utils/csrf";
import { jsonResponse, requireAuthUser, parseRequestBody } from "@/lib/utils/api-helpers";
import { VALID_COMPLETION_TYPES } from "@/lib/constants/completion";
import type { Enums } from "@/lib/supabase/types";

/** Reject bodies larger than 256 KB. */
const MAX_BODY_BYTES = 256 * 1024;

/** Server-side field length limits. */
const MAX_NOTES_LENGTH = 1000;
const MAX_EVIDENCE_URL_LENGTH = 2048;

interface CompletionInput {
  habitId: string;
  type: Enums<"completion_type">;
  evidenceUrl?: string;
  notes?: string;
}

function validateItem(item: unknown): item is CompletionInput {
  if (typeof item !== "object" || item === null) return false;
  const { habitId, type, notes, evidenceUrl } = item as Record<string, unknown>;
  if (
    typeof habitId !== "string" ||
    typeof type !== "string" ||
    !VALID_COMPLETION_TYPES.has(type)
  )
    return false;
  if (
    notes !== undefined &&
    (typeof notes !== "string" || notes.length > MAX_NOTES_LENGTH)
  )
    return false;
  if (
    evidenceUrl !== undefined &&
    (typeof evidenceUrl !== "string" ||
      evidenceUrl.length > MAX_EVIDENCE_URL_LENGTH)
  )
    return false;
  return true;
}

export async function POST(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  // Rate limiting is now handled inside the insert_completion RPC
  // (migration 017). The RPC raises ERRCODE '54000' if limit exceeded.

  const parsed = await parseRequestBody(request, MAX_BODY_BYTES);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // --- Batch mode: array of completions (used by service worker sync) ---
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return jsonResponse([], { status: 201 });
    }
    if (body.length > 50) {
      return jsonResponse(
        { error: "Batch limit is 50 items" },
        { status: 400 },
      );
    }

    for (const item of body) {
      if (!validateItem(item)) {
        return jsonResponse(
          { error: "Invalid item in batch" },
          { status: 400 },
        );
      }
    }

    // Atomic batch insert via RPC — ownership verified inside the transaction.
    const rpcItems = body.map((item: CompletionInput) => ({
      habit_id: item.habitId,
      completion_type: item.type,
      evidence_url: item.evidenceUrl ?? null,
      notes: item.notes ?? null,
    }));

    const { data, error } = await supabase.rpc("insert_completions_batch", {
      p_items: rpcItems,
    });

    if (error) {
      const isForbidden = error.code === "42501";
      console.error("Batch completion insert failed:", isForbidden ? "ownership check" : "internal");
      return jsonResponse(
        { error: isForbidden ? "Forbidden" : "Failed to save completions" },
        { status: isForbidden ? 403 : 500 },
      );
    }

    return jsonResponse(data, { status: 201 });
  }

  // --- Single mode ---
  if (typeof body !== "object" || body === null) {
    return jsonResponse(
      { error: "Request body must be an object or array" },
      { status: 400 },
    );
  }

  if (!validateItem(body)) {
    return jsonResponse(
      {
        error:
          "habitId (string) and type (photo|video|message|quick) are required",
      },
      { status: 400 },
    );
  }

  // Atomic insert via RPC — ownership verified inside the transaction.
  const { data, error } = await supabase.rpc("insert_completion", {
    p_habit_id: body.habitId,
    p_completion_type: body.type,
    p_evidence_url: body.evidenceUrl,
    p_notes: body.notes,
  });

  if (error) {
    const isForbidden = error.code === "42501";
    const isRateLimited = error.code === "54000";
    if (isRateLimited) {
      return jsonResponse(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    console.error("Completion insert failed:", isForbidden ? "ownership check" : "internal");
    return jsonResponse(
      { error: isForbidden ? "Forbidden" : "Failed to save completion" },
      { status: isForbidden ? 403 : 500 },
    );
  }

  return jsonResponse(data, { status: 201 });
}
