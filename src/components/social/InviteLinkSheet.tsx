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
    <Sheet open={open} onOpenChange={onOpenChange} size="sm" showHandle>
      {ToastElements}
      <div className="px-4 py-2 space-y-4">
        <h2
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-lg)" }}
        >
          Invite Link
        </h2>

        <p className="text-sm text-[var(--color-text-secondary)]">
          Share this link with friends to invite them to the group.
        </p>

        {inviteCode ? (
          <>
            {/* Link display */}
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2.5 text-sm font-mono text-[var(--color-text-primary)] truncate">
                {inviteUrl}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
                className="flex-shrink-0"
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
