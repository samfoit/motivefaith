import type { SupabaseClient } from "@supabase/supabase-js";

type AvatarBucket = "avatars" | "group-avatars";

/**
 * Store a cropped avatar and return the public URL to save on the profile or
 * group.
 *
 * The bucket is public, so the URL is all that guards the photo, and each
 * upload gets a new random name. A name that never changed
 * (`{owner}/avatar.webp`) could be worked out from an id alone and kept
 * showing the current photo to anyone who once had it, unfriended or not.
 * A new name is also a new address, so no cache goes on showing the old one.
 *
 * Call `removeOtherAvatars` once the URL is saved, not before: if the save
 * fails, the old photo is still the one in use.
 */
export async function uploadAvatar(
  supabase: SupabaseClient,
  bucket: AvatarBucket,
  ownerId: string,
  blob: Blob,
): Promise<string> {
  const ext = blob.type === "image/png" ? "png" : "webp";
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType: blob.type || "image/webp" });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

/**
 * Delete every photo in the owner's folder except the one `keepUrl` points
 * at (all of them, when it is null or not one of ours), so an old link stops
 * working the moment a photo is replaced. Best effort: a failure leaves an
 * orphan behind, never a broken profile.
 */
export async function removeOtherAvatars(
  supabase: SupabaseClient,
  bucket: AvatarBucket,
  ownerId: string,
  keepUrl: string | null,
): Promise<void> {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(ownerId);
    if (error || !data) return;

    const keep = keepUrl?.split("?")[0] ?? null;
    const doomed = data
      .map((file) => `${ownerId}/${file.name}`)
      .filter((path) => !keep?.endsWith(`/${bucket}/${path}`));
    if (doomed.length > 0) await supabase.storage.from(bucket).remove(doomed);
  } catch (err) {
    console.error("Failed to remove old avatars:", err);
  }
}
