"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Turnstile } from "@/components/ui/Turnstile";
import { checkRateLimitWithToast } from "@/lib/utils/rate-limit-client";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { FORGOT_PASSWORD_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from "@/lib/constants/limits";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { show: showToast, ToastElements } = useToast();
  const { captchaToken, handleToken: handleCaptchaToken, handleExpire: handleCaptchaExpire } = useCaptcha();
  const [expired] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("expired") === "true";
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!checkRateLimitWithToast("forgot-password", FORGOT_PASSWORD_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, showToast)) return;

    setLoading(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/auth/reset-password`,
        captchaToken: captchaToken ?? undefined,
      }
    );

    setLoading(false);

    // Always show success regardless of error to prevent email enumeration
    setSent(true);
  }

  return (
    <div className="w-full max-w-sm auth-card-enter">
      <div className="bg-bg-elevated rounded-lg shadow-md p-8">
        <h1 className="font-display text-2xl font-bold text-center mb-2">
          Reset password
        </h1>
        <p
          className="text-sm text-center mb-8 text-[var(--color-text-secondary)]"
        >
          {sent
            ? "Check your inbox for a reset link"
            : "Enter your email and we'll send you a reset link"}
        </p>

        {expired && !sent && (
          <div
            className="rounded-lg p-3 text-sm text-center mb-4"
            style={{
              backgroundColor: "var(--color-miss)",
              color: "white",
            }}
          >
            Your reset link has expired or was already used. Please request a new
            one.
          </div>
        )}

        {sent ? (
          <div className="space-y-4">
            <div
              className="rounded-lg p-4 text-sm text-center"
              style={{
                backgroundColor: "var(--color-brand-light)",
                color: "var(--color-text-primary)",
              }}
            >
              We sent a password reset link to{" "}
              <span className="font-medium">{email}</span>. It may take a minute
              to arrive.
            </div>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
            >
              Try a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            <Turnstile onToken={handleCaptchaToken} onExpire={handleCaptchaExpire} />

            <Button
              type="submit"
              loading={loading}
              className="w-full"
              size="lg"
            >
              Send reset link
            </Button>
          </form>
        )}

        <p
          className="text-sm text-center mt-6 text-[var(--color-text-secondary)]"
        >
          Remember your password?{" "}
          <Link
            href="/auth/login"
            className="text-brand font-medium hover:text-brand-hover"
          >
            Sign in
          </Link>
        </p>
      </div>
      {ToastElements}
    </div>
  );
}
