"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { validatePassword } from "@/lib/utils/validate-password";
import { isPasswordBreached } from "@/lib/utils/check-breached-password";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Initialise from URL so we don't call setState synchronously in the effect
  const [exchanging, setExchanging] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("code");
  });
  const [error, setError] = useState<string | null>(null);

  // Exchange the auth code for a session when redirected from the reset email
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    const supabase = createClient();
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (exchangeError) {
          router.push("/auth/forgot-password?expired=true");
          return;
        }
        // Clear the code from the URL to prevent leakage via
        // browser history, referrer headers, or shoulder-surfing.
        window.history.replaceState({}, "", "/auth/reset-password");
      })
      .catch((err) => {
        console.error("Code exchange failed:", err);
        router.push("/auth/forgot-password?expired=true");
      })
      .finally(() => setExchanging(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    const breached = await isPasswordBreached(password);
    if (breached) {
      setError("This password has appeared in a data breach. Please choose a different one.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);

    if (updateError) {
      console.error("Password reset failed:", updateError.message);
      setError("Could not update password. Please try again.");
      show({
        title: "Reset failed",
        description: "Could not update password. Please try again.",
        variant: "error",
      });
      return;
    }

    show({
      title: "Password updated",
      description: "You can now sign in with your new password",
      variant: "success",
    });

    // Brief delay so the user sees the toast
    setTimeout(() => {
      router.push("/main/dashboard");
      router.refresh();
    }, 1500);
  }

  return (
    <div className="w-full max-w-sm auth-card-enter">
      <div className="bg-bg-elevated rounded-lg shadow-md p-8">
        <h1 className="font-display text-2xl font-bold text-center mb-2">
          New password
        </h1>
        <p
          className="text-sm text-center mb-8 text-[var(--color-text-secondary)]"
        >
          Choose a new password for your account
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New password"
            type="password"
            placeholder="At least 12 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            error={error && !error.includes("match") ? error : undefined}
          />
          <Input
            label="Confirm password"
            type="password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            error={error?.includes("match") ? error : undefined}
          />

          <Button
            type="submit"
            loading={loading}
            disabled={exchanging}
            className="w-full"
            size="lg"
          >
            {exchanging ? "Verifying link\u2026" : "Update password"}
          </Button>
        </form>
      </div>
      {ToastElements}
    </div>
  );
}
