"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Turnstile } from "@/components/ui/Turnstile";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import type { AccountConfirmation } from "@/lib/auth/account-confirmation";
import { GoogleSignIn, destinationAfterGoogle } from "@/app/auth/GoogleSignIn";

const CONFIRM_PHRASE = "delete my account";

/**
 * How this account confirms it is them, as `/api/account` answers it — or
 * that the answer hasn't come yet, or didn't come at all.
 *
 * An account made with a password types it. One that signs in with Google
 * has none: a sign-in from the last ten minutes stands in for it, and past
 * that it signs in again first. Asking every account for a password left
 * the Google ones with no way to delete themselves.
 */
type Confirmation = AccountConfirmation | "checking" | "unknown";

const CONFIRMATIONS: readonly string[] = ["password", "recent_sign_in", "sign_in_again"];

async function fetchConfirmation(): Promise<Confirmation> {
  try {
    const res = await fetch("/api/account", { cache: "no-store" });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { confirmWith?: unknown };
    return typeof data.confirmWith === "string" && CONFIRMATIONS.includes(data.confirmWith)
      ? (data.confirmWith as AccountConfirmation)
      : "unknown";
  } catch {
    return "unknown";
  }
}

interface DeleteAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose profile this is, to notice a sign-in that came back as someone else. */
  userId: string;
}

export function DeleteAccountSheet({ open, onOpenChange, userId }: DeleteAccountSheetProps) {
  const queryClient = useQueryClient();
  const [confirmWith, setConfirmWith] = useState<Confirmation>("checking");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captcha = useCaptcha();
  const fieldId = useId();
  const passwordId = `${fieldId}-password`;
  const phraseId = `${fieldId}-phrase`;
  const phraseTextId = `${fieldId}-phrase-text`;

  const phraseMatches = phrase.trim().toLowerCase() === CONFIRM_PHRASE;
  const confirmed =
    confirmWith === "password" ? password.length > 0 : confirmWith === "recent_sign_in";
  const canSubmit = confirmed && phraseMatches && !loading;

  // Asked each time the dialog opens: the answer depends on how long ago the
  // session signed in.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchConfirmation().then((answer) => {
      if (!cancelled) setConfirmWith(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setConfirmWith("checking");
    setPassword("");
    setPhrase("");
    setError(null);
  };

  /**
   * Google has signed them in again, here or by sending them away and back.
   * Its chooser offers every account on the device, so it may not be this
   * one — and then this is no longer the profile the page was loaded for.
   */
  const handleSignedInAgain = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user?.id !== userId) {
      window.location.replace(await destinationAfterGoogle());
      return;
    }
    setConfirmWith(await fetchConfirmation());
  }, [userId]);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          confirmWith === "password"
            ? { password, captchaToken: captcha.captchaToken ?? undefined }
            : {},
        ),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
          code?: string;
        };
        if (data.code === "reauth_required") {
          // The ten minutes ran out with the dialog open.
          setConfirmWith("sign_in_again");
          setError("That sign-in was more than 10 minutes ago. Sign in with Google again to finish.");
          setLoading(false);
          return;
        }
        const msg = data.detail
          ? `${data.error ?? "Failed"} — ${data.detail}`
          : data.error ?? "Failed to delete account";
        setError(msg);
        // The token went with the password and can't be verified again; a
        // retry after a mistyped password needs a fresh one.
        captcha.reset();
        setLoading(false);
        return;
      }

      queryClient.clear();
      const supabase = createClient();
      try {
        await supabase.auth.signOut();
      } catch {
        // Auth user is already gone.
      }

      // Full navigation so `Providers` remounts and re-reads the persisted
      // cache buster — see handleSignOut in profile-client.tsx.
      window.location.replace("/auth/login?deleted=1");
    } catch (err) {
      console.error("Delete account failed:", err);
      setError("Network error. Please try again.");
      captcha.reset();
      setLoading(false);
    }
  };

  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100vw-2rem)] max-w-md max-h-[90vh] overflow-auto",
            "rounded-xl bg-bg-elevated shadow-xl border border-surface-hover",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-surface-hover">
            <div className="mt-0.5 rounded-full bg-miss/10 p-2 shrink-0">
              <AlertTriangle className="w-5 h-5 text-miss" />
            </div>
            <div className="flex-1 min-w-0">
              <RadixDialog.Title className="font-display text-lg font-medium text-text-primary">
                Delete account
              </RadixDialog.Title>
              <RadixDialog.Description className="text-sm text-text-secondary mt-1">
                This permanently removes your profile, habits, completions,
                friendships, and uploaded media. This cannot be undone.
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close asChild>
              <button
                aria-label="Close"
                className="ml-1 rounded-md p-1.5 text-text-secondary hover:bg-surface-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </RadixDialog.Close>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="rounded-md border border-miss/30 bg-miss/5 px-3 py-2 text-xs text-miss-ink">
              Any groups you created will be handed off to the oldest
              remaining admin, or deleted if you are the last member.
            </div>

            {confirmWith === "password" && (
              <div className="space-y-1.5">
                <label htmlFor={passwordId} className="block text-sm font-medium text-text-primary">
                  Password
                </label>
                <input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(
                    "w-full rounded-md border bg-bg-elevated px-3 py-2 text-base text-text-primary",
                    "border-surface-hover focus:outline-none focus:ring-2 focus:ring-brand-ink",
                  )}
                />
              </div>
            )}

            {/* Holds the password field's height, so the dialog doesn't jump
                when the answer comes. */}
            {confirmWith === "checking" && (
              <p role="status" className="min-h-[4.25rem] text-sm text-text-secondary">
                Checking how you sign in…
              </p>
            )}

            {confirmWith === "recent_sign_in" && (
              <p className="text-sm text-text-secondary">
                You signed in with Google a few minutes ago, so there&apos;s no
                password to enter.
              </p>
            )}

            {confirmWith === "sign_in_again" && (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">
                  This account signs in with Google, so there&apos;s no password
                  to enter. Sign in with Google again to confirm it&apos;s you,
                  then finish here within 10 minutes.
                </p>
                <GoogleSignIn onSignedIn={handleSignedInAgain} onError={setError} />
                <p className="text-xs text-text-secondary">
                  If signing in takes you out of this screen, come back to
                  Delete account.
                </p>
              </div>
            )}

            {confirmWith === "unknown" && (
              <p role="alert" className="text-sm text-miss-ink">
                Couldn&apos;t check how to confirm it&apos;s you. Close this and
                try again.
              </p>
            )}

            <div className="space-y-1.5">
              <label htmlFor={phraseId} className="block text-sm font-medium text-text-primary">
                To confirm, type the phrase below
              </label>
              <div
                id={phraseTextId}
                className="rounded-md border border-miss/40 bg-miss/10 px-3 py-2 font-mono text-base font-semibold text-miss-ink select-all text-center"
              >
                {CONFIRM_PHRASE}
              </div>
              <input
                id={phraseId}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={phraseTextId}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={`Type "${CONFIRM_PHRASE}" here`}
                className={cn(
                  "w-full rounded-md border bg-bg-elevated px-3 py-2 text-base text-text-primary",
                  "placeholder:text-text-tertiary",
                  // A match turns the border Lamp Ink, from the hour's palette;
                  // the raw green it used didn't follow the hour.
                  phraseMatches ? "border-brand-ink" : "border-surface-hover",
                  "focus:ring-brand-ink",
                  "focus:outline-none focus:ring-2",
                )}
              />
            </div>

            {/* Only the password check spends a token. */}
            {confirmWith === "password" && (
              <Turnstile
                onToken={captcha.handleToken}
                onExpire={captcha.handleExpire}
                resetKey={captcha.resetKey}
              />
            )}

            {error && <p className="text-xs text-miss-ink">{error}</p>}
          </div>

          <div className="px-5 py-4 border-t border-surface-hover flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            {/* The danger variant: an opaque Missed Red with the dark label.
                The white-on-translucent-red override fell below 4.5:1, and
                at night the dark ground showed through its hover. */}
            <Button
              variant="danger"
              size="md"
              loading={loading}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              Delete my account
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
