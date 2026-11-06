"use client";

import { useState, useCallback } from "react";
import { Copy, RefreshCw, Check } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface InviteLinkSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteCode: string | null;
  isAdmin: boolean;
  onRegenerate: () => Promise<void>;
}

export function InviteLinkSheet({
  open,
  onOpenChange,
  inviteCode,
  isAdmin,
  onRegenerate,
}: InviteLinkSheetProps) {
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const { show, ToastElements } = useToast();

  const inviteUrl =
    typeof window !== "undefined" && inviteCode
      ? `${window.location.origin}/main/feed/join/${inviteCode}`
      : "";

  const handleCopy = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      show({
        title: "Copy failed",
        description: "Could not copy to clipboard. Please copy the link manually.",
        variant: "error",
      });
    }
  }, [inviteUrl, show]);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    // The Sheet's own title and description, not a second heading in the
    // body under its empty title row. "md" only caps the height (60vh); the
    // sheet still fits its content, which a 40vh cap cut off on phones.
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Invite link"
      description="Anyone with this link can join the group."
    >
      {ToastElements}
      <div className="space-y-3">
        {inviteCode ? (
          <>
            {/* Link display */}
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2.5 text-sm font-mono text-[var(--color-text-primary)] truncate">
                {inviteUrl}
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

            {/* Regenerate (admin only) */}
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerate}
                loading={isRegenerating}
                className="w-full"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Regenerate link</span>
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">
            No invite code set for this group.
          </p>
        )}
      </div>
    </Sheet>
  );
}
