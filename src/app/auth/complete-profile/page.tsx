"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";

function validateUsername(value: string): string | null {
  if (value.length < 3) return "Username must be at least 3 characters";
  if (value.length > 30) return "Username must be 30 characters or less";
  if (!/^[a-zA-Z0-9_]+$/.test(value))
    return "Only letters, numbers, and underscores allowed";
  return null;
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    async function loadUserData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      // Pre-fill from Google/OAuth metadata
      const meta = user.user_metadata;
      setDisplayName(
        meta?.full_name || meta?.name || meta?.display_name || "",
      );
      setAvatarUrl(meta?.avatar_url || meta?.picture || null);
      setInitialLoading(false);
    }

    loadUserData();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const usernameError = validateUsername(username);
    if (usernameError) {
      setErrors({ username: usernameError });
      return;
    }

    if (!dateOfBirth) {
      setErrors({ dateOfBirth: "Date of birth is required" });
      return;
    }

    const dob = new Date(dateOfBirth + "T00:00:00");
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < dob.getDate())
    ) {
      age--;
    }
    if (age < 13) {
      setErrors({
        dateOfBirth:
          "You must be at least 13 years old to create an account",
      });
      return;
    }

    if (!tosAccepted) {
      setErrors({
        tos: "You must agree to the Terms of Service and Privacy Policy",
      });
      return;
    }

    setErrors({});
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.rpc("complete_oauth_profile", {
      p_display_name: displayName,
      p_username: username.toLowerCase(),
      p_date_of_birth: dateOfBirth,
      p_avatar_url: avatarUrl ?? undefined,
    });

    if (error) {
      const message = error.message.includes("Username already taken")
        ? "That username is already taken. Please choose another."
        : error.message.includes("13 years old")
          ? "You must be at least 13 years old"
          : "Could not complete profile. Please try again.";

      show({
        title: "Profile setup failed",
        description: message,
        variant: "error",
      });

      if (error.message.includes("Username already taken")) {
        setErrors({ username: "Username already taken" });
      }

      setLoading(false);
      return;
    }

    router.push("/main/dashboard");
    router.refresh();
  }

  if (initialLoading) {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-bg-elevated rounded-lg shadow-md p-8">
          <div className="flex justify-center">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm auth-card-enter">
      <div className="bg-bg-elevated rounded-lg shadow-md p-8">
        {avatarUrl && (
          <div className="flex justify-center mb-4">
            <Avatar src={avatarUrl} name={displayName || "User"} size="lg" />
          </div>
        )}

        <h1 className="font-display text-2xl font-bold text-center mb-2">
          Complete Your Profile
        </h1>
        <p className="text-sm text-center mb-8 text-[var(--color-text-secondary)]">
          Just a few more details to get started
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Display Name"
            type="text"
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            autoComplete="name"
          />
          <Input
            label="Username"
            type="text"
            placeholder="your_username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            error={errors.username}
          />
          <Input
            label="Date of Birth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            required
            error={errors.dateOfBirth}
          />

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tosAccepted}
              onChange={(e) => setTosAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[var(--color-brand)] rounded"
            />
            <span className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              I agree to the{" "}
              <Link
                href="/legal/terms"
                className="text-brand font-medium hover:text-brand-hover underline"
                target="_blank"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                href="/legal/privacy"
                className="text-brand font-medium hover:text-brand-hover underline"
                target="_blank"
              >
                Privacy Policy
              </Link>
            </span>
          </label>
          {errors.tos && (
            <p className="text-xs text-[var(--color-miss)]">{errors.tos}</p>
          )}

          <Button
            type="submit"
            loading={loading}
            className="w-full"
            size="lg"
            disabled={!tosAccepted}
          >
            Continue
          </Button>
        </form>
      </div>
      {ToastElements}
    </div>
  );
}
