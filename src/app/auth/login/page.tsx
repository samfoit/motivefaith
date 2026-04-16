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
import { LOGIN_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from "@/lib/constants/limits";

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

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaChallengeId, setMfaChallengeId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);

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

    // Check if MFA verification is required
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (
      aalData?.currentLevel === "aal1" &&
      aalData?.nextLevel === "aal2"
    ) {
      // User has MFA enabled — start a challenge
      const factors = await supabase.auth.mfa.listFactors();
      const totpFactor = factors.data?.totp?.find(
        (f) => f.status === "verified",
      );
      if (totpFactor) {
        const { data: challenge, error: challengeError } =
          await supabase.auth.mfa.challenge({ factorId: totpFactor.id });
        if (challengeError || !challenge) {
          setError("Failed to start MFA challenge");
          setLoading(false);
          return;
        }
        setMfaFactorId(totpFactor.id);
        setMfaChallengeId(challenge.id);
        setLoading(false);
        return;
      }
    }

    router.push("/main/dashboard");
    router.refresh();
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId || !mfaChallengeId) return;
    setMfaLoading(true);
    setMfaError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });

    if (verifyError) {
      setMfaError("Invalid code. Please try again.");
      setMfaLoading(false);
      return;
    }

    router.push("/main/dashboard");
    router.refresh();
  }

  async function handleGoogleLogin() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-0 lg:gap-12 xl:gap-16 w-full max-w-4xl xl:max-w-5xl">
      <MobileFactBanner />

      <div className="w-full max-w-sm shrink-0 auth-card-enter">
        <div className="bg-bg-elevated rounded-lg shadow-md p-8">
          <h1 className="font-display text-2xl font-bold text-center mb-2">
            MotiveFaith
          </h1>

          {mfaChallengeId ? (
            <>
              <p className="text-sm text-center mb-8 text-text-secondary">
                Enter the code from your authenticator app
              </p>

              <form onSubmit={handleMfaVerify} className="space-y-4">
                <Input
                  label="Verification code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  value={mfaCode}
                  onChange={(e) =>
                    setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                  autoFocus
                  error={mfaError}
                />

                <Button
                  type="submit"
                  loading={mfaLoading}
                  disabled={mfaCode.length !== 6}
                  className="w-full"
                  size="lg"
                >
                  Verify
                </Button>
              </form>

              <Button
                variant="ghost"
                className="w-full mt-3"
                size="sm"
                onClick={() => {
                  setMfaChallengeId(null);
                  setMfaFactorId(null);
                  setMfaCode("");
                  setMfaError(null);
                }}
              >
                Back to sign in
              </Button>
            </>
          ) : (
            <>
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
                      className="text-xs text-brand hover:text-brand-hover font-medium"
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

              <Button
                variant="secondary"
                className="w-full"
                size="lg"
                onClick={handleGoogleLogin}
              >
                <span className="inline-flex items-center">
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    className="mr-2 shrink-0"
                    aria-hidden="true"
                  >
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </span>
              </Button>

              <p className="text-sm text-center mt-6 text-text-secondary">
                Don&apos;t have an account?{" "}
                <Link
                  href="/auth/signup"
                  className="text-brand font-medium hover:text-brand-hover"
                >
                  Sign up
                </Link>
              </p>
            </>
          )}
        </div>
      </div>

      <DesktopFactsPanel />

      {ToastElements}
    </div>
  );
}
