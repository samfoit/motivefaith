"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Turnstile } from "@/components/ui/Turnstile";
import { checkRateLimitWithToast } from "@/lib/utils/rate-limit-client";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { FORGOT_PASSWORD_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from "@/lib/constants/limits";
import { AuthWordmark } from "../AuthWordmark";
import { FormAlert } from "../FormAlert";

/** The query string doesn't change while the page is open. */
const subscribeToNothing = () => () => {};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { show: showToast, ToastElements } = useToast();
  const captcha = useCaptcha();
  // `?expired=true` arrives from a dead reset link. Read like sign in's
  // notices: the server snapshot is empty, so server and first client render
  // agree and the notice appears right after hydration. (A useState
  // initializer reading `window` showed it on the first client render, which
  // the server hadn't drawn: a hydration error.)
  const search = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.search,
    () => "",
  );
  const expired = new URLSearchParams(search).get("expired") === "true";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!checkRateLimitWithToast("forgot-password", FORGOT_PASSWORD_RATE_LIMIT, RATE_LIMIT_WINDOW_MS, showToast)) return;

    setLoading(true);

    const supabase = createClient();
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
        captchaToken: captcha.captchaToken ?? undefined,
      });
    } catch {
      // Reported as sent all the same; see below.
    } finally {
      // The token was spent on this request. "Try a different email" brings
      // the form back, and it must not resend the used one.
      captcha.reset();
      setLoading(false);
    }

    // Always show success regardless of error to prevent email enumeration
    setSent(true);
  }

  return (
    <div className="w-full max-w-sm auth-card-enter">
      <div className="bg-bg-elevated rounded-lg shadow-md p-8">
        <AuthWordmark />
        <h1 className="font-display text-lg font-medium text-center mb-1">
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
          // Missed Red Ink on its wash: white on the solid red was under 4.5:1.
          <FormAlert className="mb-4">
            Your reset link has expired or was already used. Please request a new
            one.
          </FormAlert>
        )}

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg p-4 text-sm text-center bg-brand-light text-text-primary">
              We sent a password reset link to{" "}
              <span className="font-medium [overflow-wrap:anywhere]">{email}</span>. It may take a minute
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

            <Turnstile
              onToken={captcha.handleToken}
              onExpire={captcha.handleExpire}
              resetKey={captcha.resetKey}
            />

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
            className="text-brand-ink font-medium hover:text-brand-ink"
          >
            Sign in
          </Link>
        </p>
      </div>
      {ToastElements}
    </div>
  );
}
