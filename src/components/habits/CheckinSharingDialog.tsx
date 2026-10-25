"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import { useCheckinSharing } from "@/lib/hooks/useConfirmSharing";
import { recordSharingConfirmed } from "@/lib/data/checkin-sharing";
import { useCheckinSharingStore } from "@/lib/stores/checkin-sharing-store";

/**
 * The one time the app stops a check-in to say who it goes to.
 *
 * Asked by `useConfirmSharing`, from wherever the check-in was started, and
 * mounted once in the authenticated layout. Nothing is sent until
 * "Continue" is pressed; "Not now" or Escape send nothing. A tap beside the
 * dialog is not taken as either answer.
 *
 * "Continue" rather than "Check in": from the drawer or the habit page, a
 * yes opens the camera, recorder, note or sheet next, not a check-in.
 */
export function CheckinSharingDialog() {
  useCheckinSharing();
  const queryClient = useQueryClient();
  const userId = useAuthUserId();
  const question = useCheckinSharingStore((s) => s.question);
  const answer = useCheckinSharingStore((s) => s.answer);

  const audience = question?.audience ?? null;

  const confirm = () => {
    void recordSharingConfirmed(queryClient, userId);
    answer(true);
  };

  return (
    <RadixDialog.Root
      open={question !== null}
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content
          role="alertdialog"
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[min(90vw,360px)] max-h-[85dvh] overflow-y-auto rounded-xl bg-elevated p-6 shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          <RadixDialog.Title className="font-display text-lg font-medium text-text-primary">
            Your partners will see this
          </RadixDialog.Title>

          {audience ? (
            <>
              <p className="text-sm text-text-secondary mt-2">
                Checking in shares it with:
              </p>
              <ul aria-label="Shared with" className="mt-3 space-y-2">
                {audience.map((member) => (
                  <li
                    key={`${member.kind}:${member.id}`}
                    className="flex items-center gap-3"
                  >
                    {member.kind === "partner" ? (
                      <Avatar
                        src={member.avatar_url}
                        name={member.name}
                        size="sm"
                        className="shrink-0"
                      />
                    ) : (
                      <span className="w-8 h-8 shrink-0 rounded-full bg-brand-light flex items-center justify-center">
                        <Users className="w-4 h-4 text-brand-ink" aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                      {member.name}
                    </span>
                    {member.kind === "group" && (
                      <span className="shrink-0 text-xs text-text-tertiary">
                        Group
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <RadixDialog.Description className="text-sm text-text-secondary mt-4">
                It shows up in your chat with each of them, and they may get a
                notification. That&apos;s how they keep you accountable.
              </RadixDialog.Description>
            </>
          ) : (
            <RadixDialog.Description className="text-sm text-text-secondary mt-2">
              Everyone you&apos;ve added as a partner on this habit, and any
              group it&apos;s in, sees each check-in in their chat and may get
              a notification. That&apos;s how they keep you accountable.
            </RadixDialog.Description>
          )}

          <p className="text-xs text-text-tertiary mt-3">
            You won&apos;t be asked again.
          </p>

          <div className="flex gap-3 mt-5">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => answer(false)}
            >
              Not now
            </Button>
            <Button variant="primary" className="flex-1" onClick={confirm}>
              Continue
            </Button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
