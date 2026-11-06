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
    ? `${displayName} invited you to MotiveFaith — let's keep each other accountable.`
    : "Come keep me accountable on MotiveFaith.";

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
      await navigator.share({ title: "MotiveFaith", text: shareText, url });
    } catch (err) {
      // Dismissing the OS sheet rejects with AbortError. That is a choice, not
      // a failure, and must not raise a toast.
      if (err instanceof Error && err.name === "AbortError") return;
      show({ title: "Could not open share sheet", variant: "error" });
    }
  }, [url, shareText, show]);

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    // The Sheet's own title and description, not a second heading in the
    // body under its empty title row. "md" only caps the height (60vh); the
    // sheet still fits its content, which a 40vh cap cut off on phones.
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Invite a friend"
      description="It walks them through signing up and sends you a friend request. No username to type."
    >
      {ToastElements}
      <div className="space-y-3">
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
                aria-label={copied ? "Copied" : "Copy invite link"}
                className="flex-shrink-0 min-h-11 min-w-11"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            {canShare && (
              <Button className="w-full" onClick={handleShare}>
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
