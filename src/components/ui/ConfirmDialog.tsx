"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Names the action, the same words as what opened it: "Leave", "Remove". */
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
}

/**
 * Asks before something that can't be taken back — leaving a group, removing
 * someone from it, deleting it. Always destructive, so the confirm button is
 * always red.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[min(90vw,360px)] rounded-xl bg-elevated p-6 shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          <RadixDialog.Title className="font-display text-base font-medium text-text-primary">
            {title}
          </RadixDialog.Title>
          <RadixDialog.Description className="text-sm text-text-secondary mt-2">
            {description}
          </RadixDialog.Description>
          <div className="flex gap-3 mt-5">
            <RadixDialog.Close asChild>
              <Button variant="secondary" className="flex-1">
                Cancel
              </Button>
            </RadixDialog.Close>
            <Button
              variant="primary"
              className="flex-1 !bg-miss hover:!bg-miss/90"
              onClick={onConfirm}
              loading={loading}
            >
              {confirmLabel}
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
