"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Turnstile } from "@/components/ui/Turnstile";
import { checkRateLimitWithToast } from "@/lib/utils/rate-limit-client";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { DesktopFactsPanel, MobileFactBanner } from "../habit-facts";
import { GoogleSignIn, destinationAfterGoogle } from "../GoogleSignIn";
import { LOGIN_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from "@/lib/constants/limits";
import { destinationAfterAuth } from "@/lib/constants/pending-invite";

export default function LoginPage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    captchaToken,
    handleToken: handleCaptchaToken,
    handleExpire: handleCaptchaExpire,
  } = useCaptcha();

  // Read the `?deleted=1` flag once during lazy init. SSR returns false;
  // the flag matters only after a client-side redirect from account delete.
  const [deletedBanner] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("deleted") === "1";
  });
  // `?stale=1` — AuthGate bounced an orphan auth session (profile row
  // was missing, usually the tail of a failed deletion).
  const [staleBanner] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("stale") === "1";
  });

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (
      !checkRateLimitWithToast(
        "login",
        LOGIN_RATE_LIMIT,
        RATE_LIMIT_WINDOW_MS,
        show,
      )
    )
      return;

    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    if (signInError) {
      setError("Invalid email or password");
      show({
        title: "Sign in failed",
        description: "Invalid email or password",
        variant: "error",
      });
      setLoading(false);
      return;
    }

    router.push(destinationAfterAuth());
    router.refresh();
  }

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-0 lg:gap-12 xl:gap-16 w-full max-w-4xl xl:max-w-5xl">
      <MobileFactBanner />

      <div className="w-full max-w-sm shrink-0 auth-card-enter">
        <div className="bg-bg-elevated rounded-lg shadow-md p-8">
          <h1 className="font-display text-2xl font-medium text-center mb-2">
            MotiveFaith
          </h1>

          {deletedBanner && (
            <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300 text-center">
              Your account has been deleted.
            </div>
          )}

          {staleBanner && !deletedBanner && (
            <div className="mb-4 rounded-md border border-miss/30 bg-miss/10 px-3 py-2 text-sm text-miss text-center">
              Your account data is no longer available. Please contact
              support if you believe this is a mistake.
            </div>
          )}

          <p className="text-sm text-center mb-8 text-text-secondary">
            Welcome back
          </p>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              error={error ? true : false}
            />
            <div>
              <Input
                label="Password"
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                error={error}
              />
              <div className="flex justify-end mt-1.5">
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-brand-ink hover:text-brand-ink font-medium"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Turnstile
              onToken={handleCaptchaToken}
              onExpire={handleCaptchaExpire}
            />

            <Button
              type="submit"
              loading={loading}
              className="w-full"
              size="lg"
            >
              Sign in
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-bg-elevated px-2 text-text-tertiary">or</span>
            </div>
          </div>

          <GoogleSignIn
            onSignedIn={async () => {
              router.push(await destinationAfterGoogle());
              router.refresh();
            }}
            onError={(message) =>
              show({
                title: "Sign in failed",
                description: message,
                variant: "error",
              })
            }
          />

          <p className="text-sm text-center mt-6 text-text-secondary">
            Don&apos;t have an account?{" "}
            <Link
              href="/auth/signup"
              className="text-brand-ink font-medium hover:text-brand-ink"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>

      <DesktopFactsPanel />

      {ToastElements}
    </div>
  );
}
