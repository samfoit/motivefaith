"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Turnstile } from "@/components/ui/Turnstile";
import {
  checkClientRateLimit,
  getRateLimitRetryAfter,
} from "@/lib/utils/rate-limit-client";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { DesktopFactsPanel, MobileFactBanner } from "../habit-facts";
import { GoogleSignIn, destinationAfterGoogle } from "../GoogleSignIn";
import { LOGIN_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from "@/lib/constants/limits";
import { destinationAfterAuth } from "@/lib/constants/pending-invite";
import { AuthWordmark } from "../AuthWordmark";
import { FormAlert } from "../FormAlert";
import { ResendConfirmation } from "../ResendConfirmation";
import {
  CAPTCHA_PENDING_MESSAGE,
  OFFLINE_MESSAGE,
  describeAuthError,
  isOffline,
} from "../auth-errors";

/** The query string doesn't change while the page is open. */
const subscribeToNothing = () => () => {};

const EMAIL_ID = "login-email";
const PASSWORD_ID = "login-password";

type FieldErrors = { email?: string | true; password?: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Set when sign in was refused because the address isn't confirmed yet. */
  const [unconfirmed, setUnconfirmed] = useState(false);
  const captcha = useCaptcha();

  // `?deleted=1` follows account deletion; `?stale=1` means AuthGate bounced
  // an orphan auth session (profile row missing, usually the tail of a failed
  // deletion). Both arrive by full navigation, so the query is read here
  // rather than through useSearchParams, which would need a Suspense
  // boundary. The server snapshot is empty, so the server and the first
  // client render agree and the notice appears right after hydration.
  // (Reading `window` in a useState initializer showed it on the first client
  // render instead, which the server hadn't drawn: a hydration error.)
  const search = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.search,
    () => "",
  );
  const query = new URLSearchParams(search);
  const deletedBanner = query.get("deleted") === "1";
  const staleBanner = query.get("stale") === "1";

  function failForm(message: string) {
    setFieldErrors({});
    setFormError(message);
  }

  function edited() {
    if (fieldErrors.email || fieldErrors.password) setFieldErrors({});
    if (formError) setFormError(null);
    if (unconfirmed) setUnconfirmed(false);
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setUnconfirmed(false);

    const address = email.trim();
    if (!address || !password) {
      const missing = !address ? "email" : "password";
      setFormError(null);
      setFieldErrors(
        missing === "email" ? { email: "Enter your email" } : { password: "Enter your password" },
      );
      requestAnimationFrame(() =>
        document.getElementById(missing === "email" ? EMAIL_ID : PASSWORD_ID)?.focus(),
      );
      return;
    }

    if (isOffline()) {
      failForm(OFFLINE_MESSAGE);
      return;
    }
    if (captcha.required && !captcha.captchaToken) {
      failForm(CAPTCHA_PENDING_MESSAGE);
      return;
    }
    if (!checkClientRateLimit("login", LOGIN_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
      const wait = getRateLimitRetryAfter("login", RATE_LIMIT_WINDOW_MS);
      failForm(`Too many attempts. Please wait ${wait}s before trying again.`);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setLoading(true);
    let navigating = false;

    try {
      const { error } = await createClient().auth.signInWithPassword({
        email: address,
        password,
        options: captcha.captchaToken ? { captchaToken: captcha.captchaToken } : undefined,
      });

      if (error) {
        const failure = describeAuthError(error, "login");
        if (failure.field === "password") {
          // Wrong email or password: which one isn't said, so both are marked.
          setFieldErrors({ email: true, password: failure.message });
          setFormError(null);
        } else {
          failForm(failure.message);
          if (failure.unconfirmed) setUnconfirmed(true);
        }
        return;
      }

      // Stays in the loading state while the next page loads.
      navigating = true;
      router.push(destinationAfterAuth());
      router.refresh();
    } catch {
      failForm(OFFLINE_MESSAGE);
    } finally {
      if (!navigating) {
        // The token went to Supabase and can't be verified again.
        captcha.reset();
        setLoading(false);
      }
    }
  }

  /*
   * Laid out like sign up: Google first, the email form under it, and the
   * rotating fact below the card on a phone.
   */
  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-0 lg:gap-12 xl:gap-16 w-full max-w-4xl xl:max-w-5xl">
      <div className="w-full max-w-sm shrink-0 auth-card-enter">
        <div className="bg-bg-elevated rounded-lg shadow-md px-5 py-7 sm:p-8">
          <AuthWordmark />
          <h1 className="font-display text-lg font-medium text-center mb-6">
            Welcome back
          </h1>

          {deletedBanner && (
            <p
              role="status"
              className="mb-6 rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-secondary text-center"
            >
              Your account has been deleted.
            </p>
          )}

          {staleBanner && !deletedBanner && (
            <FormAlert className="mb-6">
              Your account data is no longer available. Please contact
              support if you believe this is a mistake.
            </FormAlert>
          )}

          <GoogleSignIn
            onSignedIn={async () => {
              router.push(await destinationAfterGoogle());
              router.refresh();
            }}
            onError={(message) => failForm(message)}
          />

          <div className="flex items-center gap-3 my-6 text-xs text-text-tertiary">
            <div className="flex-1 border-t border-border" />
            <span>or with email</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* noValidate: missing fields are named in the app's own words, under the field. */}
          <form onSubmit={handleEmailLogin} noValidate className="space-y-4">
            <Input
              id={EMAIL_ID}
              label="Email"
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                edited();
              }}
              required
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              error={fieldErrors.email}
            />
            <div>
              <Input
                id={PASSWORD_ID}
                label="Password"
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  edited();
                }}
                required
                autoComplete="current-password"
                enterKeyHint="go"
                error={fieldErrors.password}
              />
              <div className="flex justify-end">
                {/* Padded out to a thumb-sized target; the negative margin keeps it snug under the field. */}
                <Link
                  href="/auth/forgot-password"
                  className="-me-2 -mb-3 px-2 py-3 text-sm text-brand-ink font-medium"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Turnstile
              onToken={captcha.handleToken}
              onExpire={captcha.handleExpire}
              resetKey={captcha.resetKey}
            />

            {formError && <FormAlert>{formError}</FormAlert>}
            {unconfirmed && <ResendConfirmation email={email.trim()} />}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign in
            </Button>
          </form>

          <p className="text-sm text-center mt-6 text-text-secondary">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="text-brand-ink font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </div>

      <MobileFactBanner />
      <DesktopFactsPanel />
    </div>
  );
}
