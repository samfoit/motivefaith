"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { useKeyboardOffset } from "@/lib/hooks/useKeyboardOffset";
import {
  useShareCapture,
  type ShareCaptureParams,
} from "@/lib/hooks/useShareCapture";
import { deliverCapture, gifFits, prepareCapture } from "@/lib/capture-send";
import { MAX_GIF_SIZE_MB } from "@/lib/constants/limits";
import { ALLOWED_IMAGE_TYPES } from "@/lib/utils/media-types";
import { isUploadTooLarge } from "@/lib/utils/check-video";

/** Where the bar rests: on top of the bottom nav. */
const RESTING_BOTTOM = "calc(4rem + env(safe-area-inset-bottom))";

/** A photo or GIF the bar has just sent, for the chat to show at once. */
export interface SentChatMedia {
  /** The message row's id, so the server's copy replaces this one. */
  id: string;
  mediaPath: string;
  mediaType: "photo";
  caption: string | null;
}

interface ChatComposerProps {
  placeholder: string;
  userId: string;
  /** The one chat this bar writes to. */
  target: { kind: "friend" | "group"; id: string };
  /**
   * Send a text message. Resolves false when it didn't go, and the text is
   * put back in the box.
   */
  onSendText: (text: string) => Promise<boolean>;
  onMediaSent: (sent: SentChatMedia) => void;
}

/**
 * The message bar at the foot of a chat — the friend chat and the group chat
 * both.
 *
 * Besides text it sends a photo or a GIF: picked from the library with the
 * button beside the box, or pasted into it, which is how a GIF keyboard hands
 * one over. The picture waits above the box, where whatever is typed becomes
 * its caption, and goes when Send is pressed. It travels the same way a take
 * from the chat's camera does (`share_capture`), so it is stored, read and
 * queued offline by the same rules. Videos and voice notes stay with the
 * camera, which can trim and shrink them first.
 */
export function ChatComposer({
  placeholder,
  userId,
  target,
  onSendText,
  onMediaSent,
}: ChatComposerProps) {
  const { show, ToastElements } = useToast();
  const shareCapture = useShareCapture();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<{ file: File; previewUrl: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useKeyboardOffset(barRef, RESTING_BOTTOM);

  // The preview's object URL lasts as long as the picture waits here.
  useEffect(() => {
    if (!attachment) return;
    return () => URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

  const attach = useCallback(
    (file: File) => {
      const refuse = (title: string) => show({ title, variant: "error", duration: 6000 });

      if (file.type.startsWith("video/")) {
        refuse("Videos are sent with the camera button at the top.");
        return;
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        refuse("That file can't be sent. Use a photo or a GIF.");
        return;
      }
      // A photo is shrunk on its way out; a GIF goes whole, so it has to fit.
      if (file.type === "image/gif" && !gifFits(file)) {
        const mb = Math.ceil(file.size / (1024 * 1024));
        refuse(`GIFs can be up to ${MAX_GIF_SIZE_MB} MB. This one is ${mb} MB.`);
        return;
      }
      setAttachment({ file, previewUrl: URL.createObjectURL(file) });
    },
    [show],
  );

  const handlePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so the same picture can be picked again after removing it.
      e.target.value = "";
      if (file) attach(file);
    },
    [attach],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const file = Array.from(e.clipboardData.files).find((f) =>
        f.type.startsWith("image/"),
      );
      // Pasted text is left to the box.
      if (!file) return;
      e.preventDefault();
      attach(file);
    },
    [attach],
  );

  const submit = useCallback(async () => {
    const text = message.trim();
    if (sending || (!text && !attachment)) return;

    // Cleared at once, as a sent message's box is; put back if it didn't go.
    setMessage("");
    const restoreText = () => setMessage((current) => current || text);
    setSending(true);

    if (!attachment) {
      inputRef.current?.focus();
      const sent = await onSendText(text);
      setSending(false);
      if (!sent) restoreText();
      return;
    }

    try {
      const prepared = await prepareCapture(attachment.file, "photo", userId);
      const share: ShareCaptureParams = {
        mediaPath: prepared.mediaPath,
        mediaType: "photo",
        caption: text || undefined,
        habitIds: [],
        friendIds: target.kind === "friend" ? [target.id] : [],
        groupIds: target.kind === "group" ? [target.id] : [],
      };
      const outcome = await deliverCapture({
        prepared,
        userId,
        share,
        shareNow: shareCapture.mutateAsync,
      });

      setAttachment(null);
      if (outcome.queued) {
        // The chat can't show it until it has been sent, so it is said.
        show({
          title: "Saved",
          description: "It'll send when you're back online.",
          variant: "info",
        });
      } else {
        const ids =
          target.kind === "friend"
            ? outcome.result?.encouragement_ids
            : outcome.result?.group_message_ids;
        onMediaSent({
          id: ids?.[0] ?? prepared.id,
          mediaPath: prepared.mediaPath,
          mediaType: "photo",
          caption: text || null,
        });
      }
    } catch (err) {
      console.error("Chat attachment send failed:", err);
      // The picture stays where it was, to be sent again or removed.
      restoreText();
      show({
        title: isUploadTooLarge(err)
          ? "That file is too large to send."
          : "Couldn't send. Try again.",
        variant: "error",
      });
    } finally {
      setSending(false);
    }
  }, [message, sending, attachment, onSendText, userId, target, shareCapture, show, onMediaSent]);

  const canSend = message.trim().length > 0 || attachment !== null;

  return (
    <>
      <div
        ref={barRef}
        className="fixed inset-x-0 z-30 bg-bg-primary border-t border-border"
        style={{ bottom: RESTING_BOTTOM }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="max-w-2xl mx-auto px-4 py-3"
        >
          {attachment && (
            <div className="mb-2.5 flex">
              <div className="relative h-20 w-20 overflow-hidden rounded-xl bg-bg-secondary ring-1 ring-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for the optimizer to fetch. */}
                <img
                  src={attachment.previewUrl}
                  alt="Picture to send"
                  className="h-full w-full object-cover"
                />
                {sending ? (
                  <span
                    role="status"
                    aria-label="Sending"
                    className="absolute inset-0 flex items-center justify-center bg-black/45"
                  >
                    <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    aria-label="Remove picture"
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              aria-label="Attach a photo or GIF"
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                "text-text-secondary transition-colors hover:bg-surface-hover active:scale-95",
                "disabled:opacity-50",
              )}
            >
              <ImagePlus className="w-5 h-5" aria-hidden />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onPaste={handlePaste}
              placeholder={attachment ? "Add a caption..." : placeholder}
              maxLength={300}
              className={cn(
                "flex-1 min-w-0 rounded-full px-4 py-2.5 text-base",
                "bg-elevated ring-1 ring-border text-text-primary",
                "placeholder:text-text-tertiary",
                "focus:outline-none focus:ring-2 focus:ring-brand-ink/40",
                "transition-shadow",
              )}
            />
            <button
              type="submit"
              disabled={!canSend || sending}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                "transition-all",
                canSend
                  ? "bg-brand text-on-brand active:scale-95"
                  : "bg-elevated ring-1 ring-border text-text-tertiary",
              )}
              aria-label="Send message"
            >
              <Send className="w-4.5 h-4.5" />
            </button>
          </div>
        </form>
      </div>
      {ToastElements}
    </>
  );
}
