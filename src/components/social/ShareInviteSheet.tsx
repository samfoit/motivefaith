"use client";

import { useState, useCallback } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { invitePath } from "@/lib/constants/pending-invite";

interface ShareInviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sender's own username — the link is built from it. */
  username: string | null | undefined;
  /** Used in the share text, so the recipient sees a name they know. */
  displayName?: string | null;
}

/**
 * The sender's half of the invite flow: their personal link, and the two ways
 * anyone actually sends one — the OS share sheet on a phone, the clipboard
 * everywhere else.
 *
 * The link is just their username, so there is nothing to fetch and nothing to
 * store. It is the same identifier the Friends search already exposes; the
 * link only saves the recipient from having to type it.
 */
export function ShareInviteSheet({
  open,
  onOpenChange,
  username,
  displayName,
}: ShareInviteSheetProps) {
  const [copied, setCopied] = useState(false);
  const { show, ToastElements } = useToast();

  const url =
    typeof window !== "undefined" && username
      ? `${window.location.origin}${invitePath(username)}`
      : "";

  const shareText = displayName
    ? `${displayName} invited you to Motive — let's keep each other accountable.`
    : "Come keep me accountable on Motive.";

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      show({
        title: "Copy failed",
        description:
          "Could not copy to clipboard. Please copy the link manually.",
        variant: "error",
      });
    }
  }, [url, show]);

  const handleShare = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.share({ title: "Motive", text: shareText, url });
    } catch (err) {
      // Dismissing the OS sheet rejects with AbortError. That is a choice, not
      // a failure, and must not raise a toast.
      if (err instanceof Error && err.name === "AbortError") return;
      show({ title: "Could not open share sheet", variant: "error" });
    }
  }, [url, shareText, show]);

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} size="sm" showHandle>
      {ToastElements}
      <div className="px-4 py-2 space-y-4">
        <h2
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-lg)" }}
        >
          Invite a friend
        </h2>

        <p className="text-sm text-[var(--color-text-secondary)]">
          Send this link to someone. It walks them through making an account and
          sends you a friend request at the end — no username to type, nothing
          to search for.
        </p>

        {url ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2.5 text-sm font-mono text-[var(--color-text-primary)] truncate">
                {url}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
                aria-label="Copy invite link"
                className="flex-shrink-0"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            {canShare && (
              <Button className="w-full" size="lg" onClick={handleShare}>
                <Share2 className="w-4 h-4" />
                <span>Share link</span>
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">
            Could not build your invite link.
          </p>
        )}
      </div>
    </Sheet>
  );
}
