/**
 * The one-line text for a message in a feed preview. A photo or video sent
 * from the capture flow may have no caption, so it needs words of its own —
 * the same ones its push notification uses (migration 034).
 */
export function messagePreviewText(
  content: string | null | undefined,
  mediaType: string | null | undefined,
): string {
  if (content) return content;
  if (mediaType === "photo") return "📷 Photo";
  if (mediaType === "video") return "🎥 Video";
  return "";
}
