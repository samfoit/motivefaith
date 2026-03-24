"use client";

import React, { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationToggle } from "@/components/social/NotificationToggle";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { ALLOWED_IMAGE_TYPES, MIME_TO_EXT } from "@/lib/utils/media-types";

interface ProfileClientProps {
  userId: string;
  profile: Tables<"profiles"> | null;
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

  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);

  // Check current MFA status on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp ?? [];
      const verified = totp.find((f) => f.status === "verified");
      if (verified) {
        setMfaEnabled(true);
        setMfaFactorId(verified.id);
      }
    });
  }, []);

  // Avatar state
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [displayName, setDisplayName] = useState(
    profile?.display_name ?? "User",
  );
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
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

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      showToast({
        variant: "error",
        title: "Unsupported file type",
        description: "Use JPEG, PNG, WebP, or GIF.",
      });
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      showToast({
        variant: "error",
        title: "File too large",
        description: "Avatar must be under 5 MB.",
      });
      return;
    }

    setIsUploadingAvatar(true);
    const supabase = createClient();
    const ext = MIME_TO_EXT[file.type] ?? "jpg";
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      console.error("Avatar upload failed:", uploadError.message);
      showToast({
        variant: "error",
        title: "Upload failed",
        description: "Could not upload your avatar. Please try again.",
      });
      setIsUploadingAvatar(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);

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
                "absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-brand text-white",
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
              onChange={handleAvatarUpload}
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
                    "flex-1 rounded-md border bg-bg-elevated px-2 py-1 text-base font-bold font-display",
                    "border-surface-hover focus:outline-none focus:ring-2 focus:ring-brand",
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
                <h1
                  className="font-display font-bold text-text-primary truncate"
                  style={{ fontSize: "var(--text-xl)" }}
                >
                  {displayName}
                </h1>
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
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Theme</p>
                </div>
                <ThemeToggle />
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
            <NotificationToggle userId={userId} />
          </section>

          {/* Security — MFA */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-text-tertiary" />
              <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
                Security
              </h2>
            </div>
            <div className="rounded-lg bg-elevated p-4 shadow-sm space-y-4">
              {mfaEnabled ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      Two-factor authentication
                    </p>
                    <p className="text-xs text-text-secondary">
                      Enabled via authenticator app
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={mfaLoading}
                    className="text-miss"
                    onClick={async () => {
                      if (!mfaFactorId) return;
                      setMfaLoading(true);
                      const supabase = createClient();
                      const { error } = await supabase.auth.mfa.unenroll({
                        factorId: mfaFactorId,
                      });
                      if (error) {
                        showToast({
                          variant: "error",
                          title: "Failed to disable 2FA",
                        });
                      } else {
                        setMfaEnabled(false);
                        setMfaFactorId(null);
                        showToast({
                          variant: "success",
                          title: "Two-factor authentication disabled",
                        });
                      }
                      setMfaLoading(false);
                    }}
                  >
                    Disable
                  </Button>
                </div>
              ) : mfaEnrolling ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-text-primary">
                    Scan this QR code with your authenticator app
                  </p>
                  {mfaQr && (
                    <div className="flex justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mfaQr}
                        alt="TOTP QR Code"
                        className="w-48 h-48 rounded-lg"
                      />
                    </div>
                  )}
                  {mfaSecret && (
                    <p className="text-xs text-center text-text-secondary break-all">
                      Manual entry:{" "}
                      <span className="font-mono font-medium">{mfaSecret}</span>
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="Enter 6-digit code"
                      value={mfaVerifyCode}
                      onChange={(e) => {
                        setMfaVerifyCode(
                          e.target.value.replace(/\D/g, "").slice(0, 6),
                        );
                        setMfaError(null);
                      }}
                      className={cn(
                        "flex-1 rounded-md border bg-bg-elevated px-3 py-2 text-base text-text-primary text-center font-mono tracking-widest",
                        "border-surface-hover focus:outline-none focus:ring-2 focus:ring-indigo-500",
                      )}
                    />
                    <Button
                      size="md"
                      loading={mfaLoading}
                      disabled={mfaVerifyCode.length !== 6}
                      onClick={async () => {
                        if (!mfaFactorId) return;
                        setMfaLoading(true);
                        setMfaError(null);
                        const supabase = createClient();
                        const challenge = await supabase.auth.mfa.challenge({
                          factorId: mfaFactorId,
                        });
                        if (challenge.error) {
                          setMfaError("Failed to create challenge");
                          setMfaLoading(false);
                          return;
                        }
                        const verify = await supabase.auth.mfa.verify({
                          factorId: mfaFactorId,
                          challengeId: challenge.data.id,
                          code: mfaVerifyCode,
                        });
                        if (verify.error) {
                          setMfaError("Invalid code. Please try again.");
                        } else {
                          setMfaEnabled(true);
                          setMfaEnrolling(false);
                          setMfaQr(null);
                          setMfaSecret(null);
                          setMfaVerifyCode("");
                          showToast({
                            variant: "success",
                            title: "Two-factor authentication enabled",
                          });
                        }
                        setMfaLoading(false);
                      }}
                    >
                      Verify
                    </Button>
                  </div>
                  {mfaError && <p className="text-xs text-miss">{mfaError}</p>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      setMfaEnrolling(false);
                      setMfaQr(null);
                      setMfaSecret(null);
                      setMfaVerifyCode("");
                      setMfaError(null);
                      // Unenroll the unverified factor
                      if (mfaFactorId) {
                        const supabase = createClient();
                        const { error } = await supabase.auth.mfa.unenroll({
                          factorId: mfaFactorId,
                        });
                        if (error) {
                          console.error("Failed to unenroll MFA factor:", error.message);
                        }
                        setMfaFactorId(null);
                      }
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      Two-factor authentication
                    </p>
                    <p className="text-xs text-text-secondary">
                      Add an extra layer of security with an authenticator app
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={mfaLoading}
                    onClick={async () => {
                      setMfaLoading(true);
                      const supabase = createClient();
                      const { data, error } = await supabase.auth.mfa.enroll({
                        factorType: "totp",
                        friendlyName: "MotiveFaith Authenticator",
                      });
                      if (error || !data) {
                        showToast({
                          variant: "error",
                          title: "Failed to set up 2FA",
                        });
                      } else {
                        setMfaFactorId(data.id);
                        setMfaQr(data.totp.qr_code);
                        setMfaSecret(data.totp.secret);
                        setMfaEnrolling(true);
                      }
                      setMfaLoading(false);
                    }}
                  >
                    Enable
                  </Button>
                </div>
              )}
            </div>
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
        </div>
      </div>
      {ToastElements}
    </div>
  );
}
