"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";

const CATEGORIES = [
  { key: "spiritual", label: "Spiritual", emoji: "🙏", color: "#8b5cf6" },
  { key: "learning", label: "Learning", emoji: "📚", color: "#3b82f6" },
  { key: "fitness", label: "Fitness", emoji: "💪", color: "#ef4444" },
  { key: "health", label: "Health", emoji: "🥗", color: "#22c55e" },
  { key: "social", label: "Social", emoji: "👋", color: "#f59e0b" },
  { key: "creative", label: "Creative", emoji: "🎨", color: "#ec4899" },
] as const;

const DEFAULT_AVATARS = ["😊", "😎", "🚀", "🌟", "🎯", "🔥", "💎", "🌈"];

import { MAX_AVATAR_SIZE_BYTES } from "@/lib/constants/limits";

const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const STEP_COUNT = 3;

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 200 : -200,
    opacity: 0,
  }),
};

export default function OnboardingPage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Avatar
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Step 2: Categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Step 3: Invite
  const [inviteEmail, setInviteEmail] = useState("");

  function goNext() {
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  }

  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  function toggleCategory(key: string) {
    setSelectedCategories((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
    );
  }

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

    router.push("/main/dashboard");
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
        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-2.5 h-2.5 rounded-full transition-colors duration-200",
                i === step
                  ? "bg-brand"
                  : i < step
                    ? "bg-brand/50"
                    : "bg-gray-200",
              )}
            />
          ))}
        </div>

        <div className="overflow-hidden relative min-h-80">
          <AnimatePresence mode="wait" custom={direction}>
            {step === 0 && (
              <motion.div
                key="avatar"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
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
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="categories"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <h2 className="font-display text-xl font-bold text-center mb-2">
                  What do you want to track?
                </h2>
                <p className="text-sm text-center mb-6 text-text-secondary">
                  Select categories that interest you
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {CATEGORIES.map((cat) => {
                    const selected = selectedCategories.includes(cat.key);
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => toggleCategory(cat.key)}
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150",
                          selected
                            ? "border-current bg-opacity-10"
                            : "border-transparent bg-bg-secondary hover:bg-surface-hover",
                        )}
                        style={
                          selected
                            ? {
                                borderColor: cat.color,
                                backgroundColor: `${cat.color}15`,
                              }
                            : undefined
                        }
                      >
                        <span className="text-2xl">{cat.emoji}</span>
                        <span className="text-sm font-medium">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="invite"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <h2 className="font-display text-xl font-bold text-center mb-2">
                  Invite a friend
                </h2>
                <p className="text-sm text-center mb-6 text-text-secondary">
                  Accountability partners help you stay on track
                </p>

                <Input
                  label="Friend's email"
                  type="email"
                  placeholder="friend@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />

                <p className="text-xs mt-4 text-center text-text-tertiary">
                  You can always add friends later
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <Button variant="ghost" onClick={goBack} className="flex-1">
              Back
            </Button>
          )}

          {step < STEP_COUNT - 1 ? (
            <Button
              variant={
                step === 1 && selectedCategories.length === 0
                  ? "ghost"
                  : "primary"
              }
              onClick={goNext}
              className="flex-1"
            >
              {step === 1 && selectedCategories.length === 0 ? "Skip" : "Next"}
            </Button>
          ) : (
            <Button onClick={handleFinish} loading={loading} className="flex-1">
              Finish
            </Button>
          )}
        </div>
      </div>
      {ToastElements}
    </motion.div>
  );
}
