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
import { validatePassword } from "@/lib/utils/validate-password";
import { isPasswordBreached } from "@/lib/utils/check-breached-password";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { DesktopFactsPanel, MobileFactBanner } from "../habit-facts";

function validateUsername(value: string): string | null {
  if (value.length < 3) return "Username must be at least 3 characters";
  if (!/^[a-zA-Z0-9_]+$/.test(value))
    return "Only letters, numbers, and underscores allowed";
  return null;
}

export default function SignupPage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [emailSent, setEmailSent] = useState(false);
  const { captchaToken, handleToken: handleCaptchaToken, handleExpire: handleCaptchaExpire } = useCaptcha();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();

    const usernameError = validateUsername(username);
    if (usernameError) {
      setErrors({ username: usernameError });
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setErrors({ password: passwordError });
      return;
    }

    const breached = await isPasswordBreached(password);
    if (breached) {
      setErrors({ password: "This password has appeared in a data breach. Please choose a different one." });
      return;
    }

    // Age verification: must be at least 13
    if (!dateOfBirth) {
      setErrors({ dateOfBirth: "Date of birth is required" });
      return;
    }

    const dob = new Date(dateOfBirth + "T00:00:00");
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }

    if (age < 13) {
      setErrors({ dateOfBirth: "You must be at least 13 years old to create an account" });
      return;
    }

    if (!tosAccepted) {
      setErrors({ tos: "You must agree to the Terms of Service and Privacy Policy" });
      return;
    }

    if (!checkRateLimitWithToast("signup", 5, 60_000, show)) return;

    setErrors({});
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        ...(captchaToken ? { captchaToken } : {}),
        data: {
          display_name: displayName,
          username: username.toLowerCase(),
          date_of_birth: dateOfBirth,
        },
      },
    });

    if (error) {
      console.error("Signup error:", error.message, error);
      const description =
        error.message === "User already registered"
          ? "An account with this email already exists."
          : error.message || "Could not create account. Please try again.";
      show({ title: "Sign up failed", description, variant: "error" });
      setLoading(false);
      return;
    }

    // If email confirmation is required, session will be null
    if (!data.session) {
      setEmailSent(true);
      setLoading(false);
      return;
    }

    router.push("/auth/onboarding");
    router.refresh();
  }

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-0 lg:gap-12 xl:gap-16 w-full max-w-4xl xl:max-w-5xl">
      <MobileFactBanner />

      <div className="w-full max-w-sm shrink-0 auth-card-enter">
        {emailSent ? (
          <div className="bg-bg-elevated rounded-lg shadow-md p-8 text-center">
            <div className="text-4xl mb-4">📬</div>
            <h1 className="font-display text-2xl font-bold mb-2">
              Check your email
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              We sent a confirmation link to{" "}
              <span className="font-medium text-[var(--color-text-primary)]">{email}</span>.
              Click the link to activate your account.
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Didn&apos;t get it? Check your spam folder or{" "}
              <button
                type="button"
                onClick={() => setEmailSent(false)}
                className="text-brand font-medium hover:text-brand-hover underline"
              >
                try again
              </button>
            </p>
          </div>
        ) : (
        <div className="bg-bg-elevated rounded-lg shadow-md p-8">
          <h1 className="font-display text-2xl font-bold text-center mb-2">
            Create Account
          </h1>
          <p className="text-sm text-center mb-8 text-[var(--color-text-secondary)]">
            Start building better habits
          </p>

          <form onSubmit={handleSignup} className="space-y-4">
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
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              placeholder="At least 12 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
              error={errors.password}
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

            <Turnstile onToken={handleCaptchaToken} onExpire={handleCaptchaExpire} />

            <Button
              type="submit"
              loading={loading}
              className="w-full"
              size="lg"
              disabled={!tosAccepted}
            >
              Create account
            </Button>
          </form>

          <p className="text-sm text-center mt-6 text-[var(--color-text-secondary)]">
            Already have an account?{" "}
            <Link
              href="/auth/login"
              className="text-brand font-medium hover:text-brand-hover"
            >
              Sign in
            </Link>
          </p>
        </div>
        )}
      </div>

      <DesktopFactsPanel />

      {ToastElements}
    </div>
  );
}
