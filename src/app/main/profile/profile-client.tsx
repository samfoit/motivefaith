"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  User,
  Palette,
  Pencil,
  Camera,
  Check,
  X,
  Heart,
  Shield,
  Trash2,
  Share2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationToggle } from "@/components/social/NotificationToggle";
import { openInstallPrompt } from "@/components/pwa/InstallPrompt";
import { NotificationPreferences } from "@/components/social/NotificationPreferences";
import { usePushSubscription } from "@/lib/hooks/usePushSubscription";
import { createClient } from "@/lib/supabase/client";
import type { Json, Tables } from "@/lib/supabase/types";
import { ALLOWED_IMAGE_TYPES } from "@/lib/utils/media-types";
import { uploadAvatar } from "@/lib/utils/avatar-upload";
import { MAX_AVATAR_SOURCE_BYTES } from "@/lib/constants/limits";
import { AvatarCropper } from "@/components/ui/AvatarCropper";
import { DeleteAccountSheet } from "@/components/profile/DeleteAccountSheet";
import { ShareInviteSheet } from "@/components/social/ShareInviteSheet";

interface ProfileClientProps {
  userId: string;
  /**
   * What this page shows and edits. Notification settings come from
   * get_own_notification_settings: the column can't be read directly (042).
   */
  profile: Pick<
    Tables<"profiles">,
    "display_name" | "username" | "avatar_url" | "notification_prefs"
  > | null;
  isAdmin?: boolean;
}

export function ProfileClient({
  userId,
  profile,
  isAdmin,
}: ProfileClientProps) {
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Display name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(profile?.display_name ?? "");
  const [isSavingName, setIsSavingName] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  // Held here because the settings sheet unmounts its contents on close; this
  // reseeds them with the latest edits rather than the server-rendered prefs.
  const [notificationPrefs, setNotificationPrefs] = useState<Json | null>(
    profile?.notification_prefs ?? null,
  );

  // Push subscription state (shared with NotificationToggle)
  const {
    state: pushState,
    isLoading: pushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = usePushSubscription(userId);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [displayName, setDisplayName] = useState(
    profile?.display_name ?? "User",
  );
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // A full document navigation, not router.push(). `Providers` captures the
    // persisted-cache `buster` (the user id) once, at mount — a soft
    // navigation keeps the same React tree alive, so the signed-out app would
    // carry on using the previous user's QueryClient and restore their habits
    // from IndexedDB on the next mount. Reloading the document remounts
    // `Providers`, which re-reads the now-absent session and buckets as
    // "anon". The SIGNED_OUT listener there clears the stored data itself.
    window.location.assign("/auth/login");
  };

  const handleSaveName = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === displayName) {
      setEditName(displayName);
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_own_profile", {
      p_display_name: trimmed,
    });

    if (error) {
      showToast({ variant: "error", title: "Failed to update name" });
      setEditName(displayName);
    } else {
      setDisplayName(trimmed);
      showToast({ variant: "success", title: "Display name updated" });
      router.refresh();
    }
    setIsSavingName(false);
    setIsEditingName(false);
  };

  // A picked photo goes to the cropper first; only the square chosen there is
  // uploaded.
  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so picking the same photo again still opens the cropper.
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      showToast({
        variant: "error",
        title: "Unsupported file type",
        description: "Use JPEG, PNG, WebP, or GIF.",
      });
      return;
    }

    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      showToast({
        variant: "error",
        title: "File too large",
        description: "Choose a photo under 25 MB.",
      });
      return;
    }

    setCropFile(file);
  };

  const handleAvatarCropped = async (blob: Blob) => {
    setCropFile(null);
    setIsUploadingAvatar(true);
    const supabase = createClient();

    let publicUrl: string;
    try {
      publicUrl = await uploadAvatar(supabase, "avatars", userId, blob);
    } catch (err) {
      console.error("Avatar upload failed:", err);
      showToast({
        variant: "error",
        title: "Upload failed",
        description: "Could not upload your avatar. Please try again.",
      });
      setIsUploadingAvatar(false);
      return;
    }

    const { error: updateError } = await supabase.rpc("update_own_profile", {
      p_avatar_url: publicUrl,
    });

    if (updateError) {
      showToast({ variant: "error", title: "Failed to update profile" });
    } else {
      setAvatarUrl(publicUrl);
      showToast({ variant: "success", title: "Avatar updated" });
      router.refresh();
    }
    setIsUploadingAvatar(false);
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar src={avatarUrl} name={displayName} size="lg" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className={cn(
                "absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-brand text-on-brand",
                "flex items-center justify-center shadow-sm",
                "hover:bg-brand-hover transition-colors",
                "disabled:opacity-50",
              )}
              aria-label="Change avatar"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarPick}
            />
          </div>
          <div className="flex-1 min-w-0">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") {
                      setEditName(displayName);
                      setIsEditingName(false);
                    }
                  }}
                  autoFocus
                  className={cn(
                    "flex-1 rounded-md border bg-bg-elevated px-2 py-1 text-base font-medium font-display",
                    "border-surface-hover focus:outline-none focus:ring-2 focus:ring-brand-ink",
                  )}
                />
                <button
                  onClick={handleSaveName}
                  disabled={isSavingName}
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-success transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setEditName(displayName);
                    setIsEditingName(false);
                  }}
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* h2: the screen's h1 is "Profile", in the TopBar. */}
                <h2
                  className="font-display font-medium text-text-primary truncate"
                  style={{ fontSize: "var(--text-xl)" }}
                >
                  {displayName}
                </h2>
                <button
                  onClick={() => {
                    setEditName(displayName);
                    setIsEditingName(true);
                  }}
                  className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary transition-colors shrink-0"
                  aria-label="Edit display name"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary transition-colors shrink-0"
                  aria-label="Invite a friend"
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <p className="text-sm text-text-secondary">
              @{profile?.username ?? "unknown"}
            </p>
          </div>
        </div>

        {/* Settings sections */}
        <div className="space-y-5">
          {/* Appearance */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-4 h-4 text-text-tertiary" />
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Appearance
              </h2>
            </div>
            <div className="rounded-lg bg-elevated p-4 shadow-sm">
              {/* Wraps rather than overflows: the three-way switch needs the
                  whole row to itself on a 320px screen. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text-primary">Theme</p>
                <ThemeToggle className="min-w-0" />
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-text-tertiary" />
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Notifications
              </h2>
            </div>
            <NotificationToggle
              state={pushState}
              isLoading={pushLoading}
              onSubscribe={pushSubscribe}
              onUnsubscribe={pushUnsubscribe}
              onOpenSettings={() => setNotifSettingsOpen(true)}
              onInstall={openInstallPrompt}
            />
          </section>

          {/* Support */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-text-tertiary" />
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Support
              </h2>
            </div>
            <a
              href="https://buymeacoffee.com/samfoit"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm hover:bg-surface-hover transition-colors"
            >
              <span className="text-2xl" aria-hidden>
                &#9749;
              </span>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Buy Me a Coffee
                </p>
                <p className="text-xs text-text-secondary">
                  Support MotiveFaith development
                </p>
              </div>
            </a>
          </section>

          {/* Admin */}
          {isAdmin && (
            <section>
              <a
                href="/main/admin/moderation"
                className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm hover:bg-surface-hover transition-colors"
              >
                <Shield className="w-5 h-5 text-text-tertiary" />
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Moderation
                  </p>
                  <p className="text-xs text-text-secondary">
                    Review reported content
                  </p>
                </div>
              </a>
            </section>
          )}

          {/* Account */}
          <section>
            <Button
              variant="ghost"
              size="md"
              onClick={handleSignOut}
              className="w-full justify-start text-miss"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </Button>
          </section>

          {/* Danger Zone */}
          <section className="pt-4 border-t border-surface-hover">
            <Button
              variant="ghost"
              size="md"
              onClick={() => setDeleteOpen(true)}
              className="w-full justify-start text-miss"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Account</span>
            </Button>
          </section>
        </div>
      </div>

      <DeleteAccountSheet open={deleteOpen} onOpenChange={setDeleteOpen} />

      <Sheet
        open={notifSettingsOpen && pushState === "subscribed"}
        onOpenChange={setNotifSettingsOpen}
        title="Notifications"
        size="lg"
      >
        <div className="space-y-3">
          <NotificationPreferences
            notificationPrefs={notificationPrefs}
            onChange={setNotificationPrefs}
            className="p-0 shadow-none"
          />
          <Button
            variant="ghost"
            className="w-full"
            onClick={pushUnsubscribe}
            loading={pushLoading}
          >
            Turn off notifications on this device
          </Button>
        </div>
      </Sheet>

      <ShareInviteSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        username={profile?.username ?? null}
        displayName={profile?.display_name ?? null}
      />

      <AvatarCropper
        file={cropFile}
        onConfirm={handleAvatarCropped}
        onCancel={() => setCropFile(null)}
      />
      {ToastElements}
    </div>
  );
}
