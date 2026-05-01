"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Turnstile } from "@/components/ui/Turnstile";
import { useCaptcha } from "@/lib/hooks/useCaptcha";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

const CONFIRM_PHRASE = "delete my account";

interface DeleteAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasMfa: boolean;
}

export function DeleteAccountSheet({
  open,
  onOpenChange,
  hasMfa,
}: DeleteAccountSheetProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [phrase, setPhrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    captchaToken,
    handleToken: handleCaptchaToken,
    handleExpire: handleCaptchaExpire,
  } = useCaptcha();

  const phraseMatches = phrase.trim().toLowerCase() === CONFIRM_PHRASE;
  const totpValid = !hasMfa || /^\d{6}$/.test(totpCode);
  const canSubmit =
    password.length > 0 && phraseMatches && totpValid && !loading;

  const reset = () => {
    setPassword("");
    setTotpCode("");
    setPhrase("");
    setError(null);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          totpCode: hasMfa ? totpCode : undefined,
          captchaToken: captchaToken ?? undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const msg = data.detail
          ? `${data.error ?? "Failed"} — ${data.detail}`
          : data.error ?? "Failed to delete account";
        setError(msg);
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

      router.replace("/auth/login?deleted=1");
    } catch (err) {
      console.error("Delete account failed:", err);
      setError("Network error. Please try again.");
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
              <RadixDialog.Title className="font-display text-lg font-semibold text-text-primary">
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
            <div className="rounded-md border border-miss/30 bg-miss/5 px-3 py-2 text-xs text-miss">
              Any groups you created will be handed off to the oldest
              remaining admin, or deleted if you are the last member.
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-primary">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  "w-full rounded-md border bg-bg-elevated px-3 py-2 text-base text-text-primary",
                  "border-surface-hover focus:outline-none focus:ring-2 focus:ring-indigo-500",
                )}
              />
            </div>

            {hasMfa && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-primary">
                  Two-factor code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className={cn(
                    "w-full rounded-md border bg-bg-elevated px-3 py-2 text-base text-text-primary text-center font-mono tracking-widest",
                    "border-surface-hover focus:outline-none focus:ring-2 focus:ring-indigo-500",
                  )}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-primary">
                To confirm, type the phrase below
              </label>
              <div className="rounded-md border border-miss/40 bg-miss/10 px-3 py-2 font-mono text-base font-semibold text-miss select-all text-center">
                {CONFIRM_PHRASE}
              </div>
              <input
                type="text"
                autoComplete="off"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={`Type "${CONFIRM_PHRASE}" here`}
                className={cn(
                  "w-full rounded-md border bg-bg-elevated px-3 py-2 text-base text-text-primary",
                  "placeholder:text-text-tertiary",
                  phraseMatches
                    ? "border-green-500 focus:ring-green-500"
                    : "border-surface-hover focus:ring-indigo-500",
                  "focus:outline-none focus:ring-2",
                )}
              />
            </div>

            <Turnstile
              onToken={handleCaptchaToken}
              onExpire={handleCaptchaExpire}
            />

            {error && <p className="text-xs text-miss">{error}</p>}
          </div>

          <div className="px-5 py-4 border-t border-surface-hover flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="md"
              loading={loading}
              disabled={!canSubmit}
              className="bg-miss hover:bg-miss/80 text-white"
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
