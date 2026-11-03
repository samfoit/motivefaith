"use client";

import { useState } from "react";
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
import { validatePassword } from "@/lib/utils/validate-password";
import { isPasswordBreached } from "@/lib/utils/check-breached-password";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { DesktopFactsPanel, MobileFactBanner } from "../habit-facts";
import { GoogleSignIn, destinationAfterGoogle } from "../GoogleSignIn";
import { AuthWordmark } from "../AuthWordmark";
import { FormAlert } from "../FormAlert";
import { ResendConfirmation } from "../ResendConfirmation";
import {
  CAPTCHA_PENDING_MESSAGE,
  OFFLINE_MESSAGE,
  describeAuthError,
  isOffline,
  type AuthField,
} from "../auth-errors";

/** profiles.chk_display_name_length */
const DISPLAY_NAME_MAX = 100;
/** profiles.chk_username_format: ^[a-zA-Z0-9_]{3,30}$ */
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const SIGNUP_RATE_LIMIT = 5;
const SIGNUP_RATE_WINDOW_MS = 60_000;

type FieldKey = AuthField | "dateOfBirth" | "tos";
type Errors = Partial<Record<FieldKey, string>>;

const FIELD_ID: Record<FieldKey, string> = {
  displayName: "signup-display-name",
  username: "signup-username",
  email: "signup-email",
  password: "signup-password",
  dateOfBirth: "signup-dob",
  tos: "signup-tos",
};

function validateDisplayName(value: string): string | null {
  if (!value.trim()) return "Enter the name your friends will see";
  if (value.length > DISPLAY_NAME_MAX)
    return `Display name must be ${DISPLAY_NAME_MAX} characters or fewer`;
  return null;
}

function validateUsername(value: string): string | null {
  if (value.length < USERNAME_MIN) return "Username must be at least 3 characters";
  if (value.length > USERNAME_MAX) return "Username must be 30 characters or fewer";
  if (!/^[a-zA-Z0-9_]+$/.test(value))
    return "Only letters, numbers, and underscores allowed";
  return null;
}

/** Whole years between a YYYY-MM-DD birth date and today, or null if it isn't a real date. */
function ageOn(dateOfBirth: string, today: Date): number | null {
  const dob = new Date(dateOfBirth + "T00:00:00");
  if (Number.isNaN(dob.getTime())) return null;
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function validateDateOfBirth(value: string): string | null {
  if (!value) return "Date of birth is required";
  const age = ageOn(value, new Date());
  if (age === null || age > 120) return "Enter a valid date of birth";
  if (age < 0) return "Date of birth can't be in the future";
  if (age < 13) return "You must be at least 13 years old to create an account";
  return null;
}

/** People paste "@name" from an invite link or a friend's profile. */
function cleanUsername(value: string): string {
  return value.trim().replace(/^@/, "");
}

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const captcha = useCaptcha();

  /** Show one field's error and put the cursor there, so it's never off screen. */
  function failField(field: FieldKey, message: string) {
    setErrors({ [field]: message });
    setFormError(null);
    // After React commits the error, so the field's aria-describedby is set
    // and the message is read with it.
    requestAnimationFrame(() => document.getElementById(FIELD_ID[field])?.focus());
  }

  function failForm(message: string) {
    setErrors({});
    setFormError(message);
  }

  /** Typing into a field clears the error under it. */
  function edited(field: FieldKey) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (formError) setFormError(null);
  }

  /**
   * Google's button here signs up someone new — who finishes their profile
   * next, where the age check and the terms are — or signs in someone who
   * already has an account.
   */
  async function handleGoogleSignedIn() {
    router.push(await destinationAfterGoogle());
    router.refresh();
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const name = cleanUsername(username);

    // Everything that can be checked here, in the order the fields appear,
    // before anything goes over the network.
    const local: [FieldKey, string | null][] = [
      ["displayName", validateDisplayName(displayName)],
      ["username", validateUsername(name)],
      ["password", validatePassword(password)],
      ["dateOfBirth", validateDateOfBirth(dateOfBirth)],
      ["tos", tosAccepted ? null : "You must agree to the Terms of Service and Privacy Policy"],
    ];
    const firstLocal = local.find(([, message]) => message);
    if (firstLocal) {
      failField(firstLocal[0], firstLocal[1]!);
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
    if (!checkClientRateLimit("signup", SIGNUP_RATE_LIMIT, SIGNUP_RATE_WINDOW_MS)) {
      const wait = getRateLimitRetryAfter("signup", SIGNUP_RATE_WINDOW_MS);
      failForm(`Too many attempts. Please wait ${wait}s before trying again.`);
      return;
    }

    setErrors({});
    setFormError(null);
    setLoading(true);
    let sentToken = false;
    let navigating = false;

    try {
      if (await isPasswordBreached(password)) {
        failField(
          "password",
          "This password has appeared in a data breach. Please choose a different one.",
        );
        return;
      }

      sentToken = true;
      const { data, error } = await createClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          ...(captcha.captchaToken ? { captchaToken: captcha.captchaToken } : {}),
          data: {
            display_name: displayName.trim(),
            username: name.toLowerCase(),
            date_of_birth: dateOfBirth,
          },
        },
      });

      if (error) {
        const failure = describeAuthError(error, "signup");
        if (failure.field) failField(failure.field, failure.message);
        else failForm(failure.message);
        return;
      }

      // With email confirmation on, Supabase answers an address that already
      // has an account with a stand-in user that has no identities, and sends
      // nothing. Say so, as the confirmation-off path does, rather than
      // waiting for an email that will never come.
      if (data.user && data.user.identities?.length === 0) {
        failField("email", "An account with this email already exists. Sign in instead.");
        return;
      }

      // Without a session, the address has to be confirmed first.
      if (!data.session) {
        setEmailSent(true);
        return;
      }

      // Stays in the loading state while the next page loads.
      navigating = true;
      router.push("/auth/onboarding");
      router.refresh();
    } catch {
      failForm(OFFLINE_MESSAGE);
    } finally {
      if (!navigating) {
        // The token went to Supabase and can't be verified again.
        if (sentToken) captcha.reset();
        setLoading(false);
      }
    }
  }

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-0 lg:gap-12 xl:gap-16 w-full max-w-4xl xl:max-w-5xl">
      <div className="w-full max-w-sm shrink-0 auth-card-enter">
        {emailSent ? (
          <EmailSent email={email.trim()} onBack={() => setEmailSent(false)} />
        ) : (
        <div className="bg-bg-elevated rounded-lg shadow-md px-5 py-7 sm:p-8">
          <AuthWordmark />
          <h1 className="font-display text-lg font-medium text-center mb-6">
            Create your account
          </h1>

          <GoogleSignIn
            onSignedIn={handleGoogleSignedIn}
            onError={(message) => failForm(message)}
          />

          <div className="flex items-center gap-3 my-6 text-xs text-text-tertiary">
            <div className="flex-1 border-t border-border" />
            <span>or with email</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* noValidate: the checks above say what's wrong in the app's own
              words, under the field, instead of the browser's bubble. */}
          <form onSubmit={handleSignup} noValidate className="space-y-4">
            <Input
              id={FIELD_ID.displayName}
              label="Display Name"
              type="text"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                edited("displayName");
              }}
              required
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="name"
              autoCapitalize="words"
              dir="auto"
              enterKeyHint="next"
              error={errors.displayName}
            />
            <Input
              id={FIELD_ID.username}
              label="Username"
              type="text"
              placeholder="your_username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                edited("username");
              }}
              required
              // One over, so a pasted "@name" of the full 30 still fits before the @ is dropped.
              maxLength={USERNAME_MAX + 1}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              helper="3–30 letters, numbers, or underscores"
              error={errors.username}
            />
            <Input
              id={FIELD_ID.email}
              label="Email"
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                edited("email");
              }}
              required
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              error={errors.email}
            />
            <Input
              id={FIELD_ID.password}
              label="Password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                edited("password");
              }}
              required
              minLength={12}
              autoComplete="new-password"
              enterKeyHint="next"
              helper="At least 12 characters, with upper- and lowercase letters and a number"
              error={errors.password}
            />
            <Input
              id={FIELD_ID.dateOfBirth}
              label="Date of Birth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => {
                setDateOfBirth(e.target.value);
                edited("dateOfBirth");
              }}
              required
              min="1900-01-01"
              autoComplete="bday"
              error={errors.dateOfBirth}
            />

            <div>
              {/* The whole row is the target, so the small box still meets the Thumb Rule. */}
              <label className="flex items-start gap-3 py-1 cursor-pointer">
                <input
                  id={FIELD_ID.tos}
                  type="checkbox"
                  checked={tosAccepted}
                  onChange={(e) => {
                    setTosAccepted(e.target.checked);
                    edited("tos");
                  }}
                  aria-invalid={errors.tos ? true : undefined}
                  aria-describedby={errors.tos ? "signup-tos-error" : undefined}
                  className="mt-px w-5 h-5 shrink-0 accent-[var(--color-brand)] rounded"
                />
                <span className="text-sm text-text-secondary leading-snug">
                  I agree to the{" "}
                  <Link
                    href="/legal/terms"
                    className="text-brand-ink font-medium underline"
                    target="_blank"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/legal/privacy"
                    className="text-brand-ink font-medium underline"
                    target="_blank"
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
              {errors.tos && (
                <p id="signup-tos-error" className="text-xs text-miss-ink mt-1" aria-live="assertive">
                  {errors.tos}
                </p>
              )}
            </div>

            <Turnstile
              onToken={captcha.handleToken}
              onExpire={captcha.handleExpire}
              resetKey={captcha.resetKey}
            />

            {formError && <FormAlert>{formError}</FormAlert>}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Create account
            </Button>
          </form>

          <p className="text-sm text-center mt-6 text-text-secondary">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-brand-ink font-medium">
              Sign in
            </Link>
          </p>
        </div>
        )}
      </div>

      <MobileFactBanner />
      <DesktopFactsPanel />
    </div>
  );
}

/**
 * After sign up, while the address waits to be confirmed. The link can be
 * sent again (Supabase limits how often), and "Use a different email" goes
 * back to the filled-in form.
 */
function EmailSent({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="bg-bg-elevated rounded-lg shadow-md px-5 py-8 sm:p-8 text-center">
      <AuthWordmark />
      <div className="text-4xl my-4" aria-hidden="true">📬</div>
      <h1 className="font-display text-lg font-medium mb-2">Check your email</h1>
      <p className="text-sm text-text-secondary mb-6">
        We sent a confirmation link to{" "}
        <span className="font-medium text-text-primary [overflow-wrap:anywhere]">{email}</span>.
        Click the link to activate your account.
      </p>

      <ResendConfirmation email={email} />

      <p className="text-xs text-text-secondary mt-4">
        Not in your inbox? Check spam, or{" "}
        <button
          type="button"
          onClick={onBack}
          className="text-brand-ink font-medium underline"
        >
          use a different email
        </button>
      </p>
    </div>
  );
}
