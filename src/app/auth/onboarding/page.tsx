"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";

const DEFAULT_AVATARS = ["😊", "😎", "🚀", "🌟", "🎯", "🔥", "💎", "🌈"];

import { MAX_AVATAR_SIZE_BYTES } from "@/lib/constants/limits";
import { destinationAfterAuth } from "@/lib/constants/pending-invite";

const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [loading, setLoading] = useState(false);

  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      show({
        title: "Invalid file type",
        description: "Please upload a JPEG, PNG, WebP, or GIF image.",
        variant: "error",
      });
      return;
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      show({
        title: "File too large",
        description: "Avatar must be under 5 MB.",
        variant: "error",
      });
      return;
    }
    setAvatarFile(file);
    setSelectedEmoji(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleFinish() {
    setLoading(true);
    const supabase = createClient();

    let avatarUrl: string | null = null;

    // Upload avatar file if selected
    if (avatarFile) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const ext =
          {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/gif": "gif",
          }[avatarFile.type] ?? "jpg";
        const path = `${user.id}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });

        if (uploadError) {
          console.error("Avatar upload failed:", uploadError.message);
          show({
            title: "Avatar upload failed",
            description: "Could not upload your avatar. Please try again.",
            variant: "error",
          });
        } else {
          const {
            data: { publicUrl },
          } = supabase.storage.from("avatars").getPublicUrl(path);
          avatarUrl = publicUrl;
        }
      }
    } else if (selectedEmoji) {
      // Store emoji as avatar_url (can be rendered by Avatar component)
      avatarUrl = `emoji:${selectedEmoji}`;
    }

    // Update profile
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl || "emoji:😊" })
        .eq("id", user.id);

      if (error) {
        console.error("Profile update failed:", error.message);
        show({
          title: "Profile update failed",
          description: "Could not save your profile. Please try again.",
          variant: "error",
        });
        setLoading(false);
        return;
      }
    }

    router.push(destinationAfterAuth());
    router.refresh();
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md"
    >
      <div className="bg-bg-elevated rounded-lg shadow-md p-8">
        <h2 className="font-display text-xl font-bold text-center mb-2">
          Choose your avatar
        </h2>
        <p className="text-sm text-center mb-6 text-text-secondary">
          Pick an emoji or upload a photo
        </p>

        <div className="flex justify-center mb-6">
          <Avatar
            src={avatarPreview}
            name={selectedEmoji || "?"}
            size="lg"
          />
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          {DEFAULT_AVATARS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setSelectedEmoji(emoji);
                setAvatarPreview(null);
                setAvatarFile(null);
              }}
              className={cn(
                "flex items-center justify-center h-14 rounded-md text-2xl transition-all duration-150",
                selectedEmoji === emoji
                  ? "bg-brand-light ring-2 ring-brand"
                  : "bg-bg-secondary hover:bg-surface-hover",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>

        <label className="block cursor-pointer">
          <span className="inline-flex items-center justify-center w-full px-3 py-1.5 text-sm font-medium rounded-md bg-transparent text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors">
            Upload photo
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>

        <div className="mt-8">
          <Button onClick={handleFinish} loading={loading} className="w-full">
            Get started
          </Button>
        </div>
      </div>
      {ToastElements}
    </motion.div>
  );
}
