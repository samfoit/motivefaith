import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Store a cropped avatar and return the public URL to save on the profile or
 * group.
 *
 * The file keeps one name per owner, so a new photo replaces the old one in
 * place. The URL carries a version for the same reason: without it the
 * address would not change, and every browser, the image optimiser and the
 * CDN would go on showing the photo they already had.
 */
export async function uploadAvatar(
  supabase: SupabaseClient,
  bucket: "avatars" | "group-avatars",
  ownerId: string,
  blob: Blob,
): Promise<string> {
  const ext = blob.type === "image/png" ? "png" : "webp";
  const path = `${ownerId}/avatar.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { upsert: true, contentType: blob.type || "image/webp" });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);
  return `${publicUrl}?v=${Date.now()}`;
}
