"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { validatePassword } from "@/lib/utils/validate-password";
import { isPasswordBreached } from "@/lib/utils/check-breached-password";

type ResetLink =
  | { status: "ready"; tokenHash: string | null }
  | { status: "invalid" };

/**
 * Works out whether this visit can set a password.
 *
 * The email links here with a `token_hash`, which is verified on submit and
 * works in any browser. That matters on phones: the reset is often requested
 * in one browser (the installed app, Safari) and the link opened in another
 * (the mail app's in-app browser), and a PKCE `code` can only be redeemed in
 * the browser that requested it.
 *
 * Without a token, the visit needs a session: either one the Supabase client
 * just made from a `?code=` link (it redeems those itself on start-up, which
 * `getSession()` waits for — redeeming it again here would fail and bounce a
 * working link to "expired"), or the user is simply signed in.
 *
 * A link that was already used or has expired comes back from Supabase with
 * `error_code` in the query or hash and no credential at all. Showing the
 * form for it only lets the user type a password that can never be saved.
 */
async function inspectResetLink(): Promise<ResetLink> {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (query.has("error_code") || hash.has("error_code")) {
    return { status: "invalid" };
  }

  const tokenHash = query.get("token_hash");
  if (tokenHash && query.get("type") === "recovery") {
    return { status: "ready", tokenHash };
  }

  const { data } = await createClient().auth.getSession();
  return data.session ? { status: "ready", tokenHash: null } : { status: "invalid" };
}

function describeUpdateError(error: AuthError): string {
  switch (error.code) {
    case "same_password":
      return "Your new password must be different from your current one.";
    case "weak_password":
      return error.message;
    default:
      return "Could not update password. Please try again.";
  }
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The recovery token from the email, held until the user submits. It is
  // only spent at that point, so nothing that happens to the page before then
  // (a reload for an app update, a mail scanner prefetching the link, the
  // user switching apps) can use it up.
  const tokenHash = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    inspectResetLink().then((link) => {
      if (cancelled) return;
      if (link.status === "invalid") {
        router.replace("/auth/forgot-password?expired=true");
        return;
      }
      tokenHash.current = link.tokenHash;
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
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

    if (tokenHash.current) {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash.current,
      });
      if (verifyError) {
        console.error("Reset link verification failed:", verifyError.message);
        router.replace("/auth/forgot-password?expired=true");
        return;
      }
      // Spent: a retry after a rejected password reuses the session it
      // created. Drop it from the URL so it isn't left in history either.
      tokenHash.current = null;
      window.history.replaceState({}, "", "/auth/reset-password");
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);

    if (updateError) {
      console.error("Password reset failed:", updateError.message);
      if (isAuthSessionMissingError(updateError)) {
        router.replace("/auth/forgot-password?expired=true");
        return;
      }
      const message = describeUpdateError(updateError);
      setError(message);
      show({
        title: "Reset failed",
        description: message,
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
        <h1 className="font-display text-2xl font-medium text-center mb-2">
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
            disabled={checking}
            className="w-full"
            size="lg"
          >
            {checking ? "Verifying link\u2026" : "Update password"}
          </Button>
        </form>
      </div>
      {ToastElements}
    </div>
  );
}
