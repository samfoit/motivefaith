import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOtherAvatars, uploadAvatar } from "../avatar-upload";

const BASE = "https://proj.supabase.co/storage/v1/object/public";

function fakeStorage(files: string[]) {
  const remove = vi.fn().mockResolvedValue({ error: null });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const bucket = {
    list: vi.fn().mockResolvedValue({ data: files.map((name) => ({ name })), error: null }),
    remove,
    upload,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `${BASE}/avatars/${path}` } }),
  };
  const supabase = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  return { supabase, remove, upload };
}

describe("uploadAvatar", () => {
  it("gives every upload a new, unguessable name", async () => {
    const { supabase, upload } = fakeStorage([]);
    const blob = new Blob(["x"], { type: "image/webp" });

    const a = await uploadAvatar(supabase, "avatars", "u1", blob);
    const b = await uploadAvatar(supabase, "avatars", "u1", blob);

    expect(a).not.toBe(b);
    expect(a).not.toContain("avatar.webp");
    expect(a).toMatch(/\/avatars\/u1\/[0-9a-f-]{36}\.webp$/);
    // Never overwrites in place.
    expect(upload.mock.calls[0][2]).not.toHaveProperty("upsert");
  });
});

describe("removeOtherAvatars", () => {
  it("keeps the saved photo and removes the rest, the old fixed name included", async () => {
    const { supabase, remove } = fakeStorage(["avatar.webp", "old.webp", "new.webp"]);

    await removeOtherAvatars(supabase, "avatars", "u1", `${BASE}/avatars/u1/new.webp`);

    expect(remove).toHaveBeenCalledWith(["u1/avatar.webp", "u1/old.webp"]);
  });

  it("removes every photo when an emoji replaced them", async () => {
    const { supabase, remove } = fakeStorage(["a.webp"]);

    await removeOtherAvatars(supabase, "avatars", "u1", "emoji:😊");

    expect(remove).toHaveBeenCalledWith(["u1/a.webp"]);
  });

  it("does nothing when only the saved photo is there", async () => {
    const { supabase, remove } = fakeStorage(["new.webp"]);

    await removeOtherAvatars(supabase, "avatars", "u1", `${BASE}/avatars/u1/new.webp?v=1`);

    expect(remove).not.toHaveBeenCalled();
  });
});
