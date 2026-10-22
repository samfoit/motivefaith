import type { Tables } from "@/lib/supabase/types";

/**
 * The embed that brings a private check-in's real content along with its
 * completion row. Only the owner can read `completion_private_content`, so
 * for anyone else the embed is always null.
 */
export const PRIVATE_CONTENT_EMBED =
  "completion_private_content(completion_type, evidence_url, notes)";

type PrivateContent = Pick<
  Tables<"completion_private_content">,
  "completion_type" | "evidence_url" | "notes"
>;

type CompletionLike = {
  completion_type: Tables<"completions">["completion_type"];
  evidence_url: string | null;
  notes: string | null;
};

/**
 * Put a private check-in's content back on its row, for the owner's history.
 *
 * A private check-in's completion row is a plain quick one (039), so what was
 * actually recorded lives in the side table. With the embed present, its
 * type, media and note replace the row's.
 */
export function mergePrivateContent<
  T extends CompletionLike & {
    completion_private_content?: PrivateContent | PrivateContent[] | null;
  },
>(
  row: T,
): Omit<T, "completion_private_content"> & { is_private: boolean } {
  const { completion_private_content: embed, ...rest } = row;
  // One-to-one on the primary key, so PostgREST sends an object; an array is
  // tolerated in case the relationship is ever read as one-to-many.
  const content = Array.isArray(embed) ? embed[0] : embed;
  if (!content) return { ...rest, is_private: false };
  return {
    ...rest,
    completion_type: content.completion_type,
    evidence_url: content.evidence_url,
    notes: content.notes,
    is_private: true,
  };
}
