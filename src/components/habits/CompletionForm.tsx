"use client";

import React, { useState, useRef, useEffect } from "react";
import { CloudRain, CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { createClient } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import { compressImage } from "@/lib/utils/compress-image";
import { ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES, MIME_TO_EXT } from "@/lib/utils/media-types";
import { checkVideo, isUploadTooLarge } from "@/lib/utils/check-video";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { PrivateToggle } from "@/components/habits/PrivateToggle";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";

const CameraCapture = dynamic(
  () => import("@/components/habits/CameraCapture").then((m) => m.CameraCapture),
  { ssr: false },
);

const VoiceRecorder = dynamic(
  () => import("@/components/habits/VoiceRecorder").then((m) => m.VoiceRecorder),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "select" | "message" | "rain_check";

export interface CompletionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habitId: string;
  habitTitle: string;
  habitEmoji: string;
  /**
   * The habit's `schedule` column. Only the move picker needs it, to work out
   * which days the habit is free on.
   */
  habitSchedule?: unknown;
  /**
   * Check-in already chosen elsewhere (the habit card's drawer), so the sheet
   * skips its own picker and opens on that step. Backing out of the step lands
   * on the picker as usual.
   */
  initialAction?: "content" | "voice" | "message" | "rain_check" | null;
  /**
   * The owner's IANA timezone. Only the move picker needs it, to offer the
   * right "next 7 days" — falls back to the browser's zone.
   */
  timezone?: string;
  /**
   * The habit's "keep check-in content private" setting. The note or media
   * starts private when it is on; the switch in the sheet overrides it for
   * this one check-in.
   */
  defaultPrivate?: boolean;
  /**
   * Whether the picker offers a rain check. Off once the habit is done for
   * the day — the sheet then logs doing it again, and there is nothing left
   * to skip — or when today can't be skipped for another reason.
   */
  allowRainCheck?: boolean;
  onComplete: (params: {
    type: CompletionType;
    evidenceUrl?: string;
    notes?: string;
    rainCheckReason?: RainCheckReason;
    /** The day a rain check was moved to, as a YYYY-MM-DD key. */
    rainCheckMovedTo?: string;
    /** Keep the note or media in the owner's history only. */
    isPrivate?: boolean;
  }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { MAX_MESSAGE_LENGTH, MAX_IMAGE_SIZE_MB } from "@/lib/constants/limits";
import type { CompletionType } from "@/lib/constants/completion";
import {
  RAIN_CHECK_MOVE_WINDOW_DAYS,
  RAIN_CHECK_REASONS,
  type RainCheckReason,
} from "@/lib/constants/rain-check";
import { movableDayKeys } from "@/lib/utils/schedule";
import { getBrowserTimezone, weekdayName } from "@/lib/utils/timezone";


/**
 * Chip labels for the offerable days. Formatted at UTC noon so they can't
 * drift across a DST boundary — the keys themselves already came from the
 * owner's timezone.
 */
function moveOptions(dayKeys: string[]) {
  return dayKeys.map((key) => {
    const date = new Date(key + "T12:00:00Z");
    return {
      key,
      weekday: date.toLocaleDateString("en-GB", {
        weekday: "short",
        timeZone: "UTC",
      }),
      dayOfMonth: String(date.getUTCDate()),
    };
  });
}

/** A rain-check option: a tile, toggle half or day, centered. */
const RAIN_OPTION = cn(
  "flex items-center justify-center border text-center transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ink",
);
/** Picked: Rain Blue wash and border, the label in the hour's ink. */
const RAIN_PICKED =
  "font-medium text-text-primary border-[var(--color-rain)] bg-[color-mix(in_srgb,var(--color-rain)_12%,transparent)]";
const RAIN_UNPICKED =
  "border-[var(--color-surface-hover)] text-text-secondary hover:bg-surface-hover";

function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompletionForm({
  open,
  onOpenChange,
  habitId,
  habitTitle,
  habitEmoji,
  habitSchedule,
  initialAction,
  timezone,
  defaultPrivate = false,
  allowRainCheck = true,
  onComplete,
}: CompletionFormProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * A file from the picker — where the camera can't run, or from its "Use
   * File Picker Instead" — reviewed on the camera's own screen like a take.
   * Numbered so that each pick remounts the camera on it.
   */
  const [picked, setPicked] = useState<{ file: File; n: number } | null>(null);
  const [message, setMessage] = useState("");
  const [rainCheckReason, setRainCheckReason] =
    useState<RainCheckReason | null>(null);
  // null = a plain skip. A date key = "I'll do it that day instead", which
  // turns the skip into a promise the streak logic will hold you to.
  const [rainCheckMovedTo, setRainCheckMovedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [isPrivate, setIsPrivate] = useState(defaultPrivate);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Proxy input: on iOS, the keyboard only opens when focus occurs
  // synchronously inside a user-gesture handler. Since the TextArea doesn't
  // exist yet when "Message" is tapped, we focus this invisible proxy first,
  // then transfer focus once the TextArea mounts.
  const proxyInputRef = useRef<HTMLInputElement>(null);

  // Empty for a habit scheduled every day — it has no free day to move onto,
  // so the sheet offers no move at all.
  const moveChoices = moveOptions(
    movableDayKeys(
      { schedule: habitSchedule },
      timezone ?? getBrowserTimezone(),
      RAIN_CHECK_MOVE_WINDOW_DAYS,
    ),
  );
  const canMove = moveChoices.length > 0;

  // Each check-in starts from the habit's setting, whatever the last one was.
  // Adjusted during render rather than in an effect, so the sheet never
  // paints one frame with the previous check-in's choice.
  const [privacySync, setPrivacySync] = useState({ open, defaultPrivate });
  if (privacySync.open !== open || privacySync.defaultPrivate !== defaultPrivate) {
    setPrivacySync({ open, defaultPrivate });
    if (open) setIsPrivate(defaultPrivate);
  }

  // Jump straight to the step the habit card asked for. Deliberately keyed on
  // `open` alone: re-running it would drag the user back here after they hit
  // "back", or reopen a camera they just dismissed.
  useEffect(() => {
    if (!open || !initialAction) return;
    if (initialAction === "content") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- camera support is only knowable in the browser, and the fallback clicks the file input.
      if (isCameraSupported()) setCameraOpen(true);
      else fileInputRef.current?.click();
    } else if (initialAction === "voice") {
      setVoiceOpen(true);
    } else if (initialAction === "rain_check") {
      setMode("rain_check");
    } else {
      setMode("message");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Transfer focus from proxy to real textarea once it mounts
  useEffect(() => {
    if (mode === "message" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  const reset = () => {
    setMode("select");
    setPicked(null);
    setMessage("");
    setRainCheckReason(null);
    setRainCheckMovedTo(null);
    setError(null);
    setIsSubmitting(false);
    setCameraOpen(false);
    setVoiceOpen(false);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  // --- Option selection ---

  const handleContentSelect = () => {
    setError(null);
    if (isCameraSupported()) {
      setCameraOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleMessageSelect = () => {
    setError(null);
    // Focus proxy immediately within the tap handler so iOS opens the keyboard
    proxyInputRef.current?.focus();
    setMode("message");
  };

  const handleVoiceSelect = () => {
    setError(null);
    setVoiceOpen(true);
  };

  const handleQuickCheckin = () => {
    setError(null);
    onComplete({ type: "quick" });
    handleClose(false);
  };

  const handleRainCheckSelect = () => {
    setError(null);
    setMode("rain_check");
  };

  // --- Camera capture handlers ---

  /**
   * Submit on the camera's or the recorder's review, the last step: the take
   * uploads with the review still up behind it, so a failure leaves the take,
   * its caption and the private switch as they were, to try again.
   */
  const submitTake = async (
    file: File,
    type: "photo" | "video" | "voice",
    caption?: string,
  ) => {
    try {
      const url = await uploadFile(file, type);
      onComplete({ type, evidenceUrl: url, notes: caption, isPrivate });
      handleClose(false);
    } catch (err) {
      console.error("Upload failed:", err);
      // The review shows it.
      throw new Error(
        isUploadTooLarge(err)
          ? "That file is too large to send."
          : "Upload failed. Please try again.",
      );
    }
  };

  const handleCameraCapture = (file: File, caption?: string) =>
    submitTake(file, file.type.startsWith("video") ? "video" : "photo", caption);

  const handleCameraFallback = () => {
    // Don't close camera here — Radix Dialog's focus management will
    // dismiss the native file picker if the Sheet re-opens. Leave camera
    // open behind the picker; it reopens on the file's review once one is
    // picked.
    fileInputRef.current?.click();
  };

  const handleCameraClose = () => {
    setCameraOpen(false);
    setPicked(null);
  };

  // --- Voice capture handlers ---

  const handleVoiceCapture = (file: File) => submitTake(file, "voice");

  const handleVoiceClose = () => {
    setVoiceOpen(false);
  };

  // --- File handling ---

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // The error banner is in the sheet, which the camera overlay hides in the
    // fallback flow, so a refusal closes the overlay to bring it into view.
    const refuse = (message: string) => {
      handleCameraClose();
      setError(message);
    };

    if (!ALLOWED_IMAGE_TYPES.has(file.type) && !ALLOWED_VIDEO_TYPES.has(file.type)) {
      refuse("Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.");
      return;
    }

    if (
      ALLOWED_IMAGE_TYPES.has(file.type) &&
      file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024
    ) {
      refuse(`Image must be under ${MAX_IMAGE_SIZE_MB}MB`);
      return;
    }

    if (ALLOWED_VIDEO_TYPES.has(file.type)) {
      const problem = await checkVideo(file);
      if (problem) {
        refuse(problem);
        return;
      }
    }

    // Onto the camera's review, as a take would be: opened on it, or, in the
    // fallback flow, reopened on it.
    setError(null);
    setPicked((prev) => ({ file, n: (prev?.n ?? 0) + 1 }));
    setCameraOpen(true);
  };

  // --- Upload ---

  const uploadFile = async (
    file: File,
    type: "photo" | "video" | "voice",
  ): Promise<string> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // The bare type: a recorder's "video/webm;codecs=vp9", or a voice note's
    // "audio/webm;codecs=opus", is not in MIME_TO_EXT and would go up as
    // ".bin". As in QuickCaptureFlow.
    let uploadBlob: Blob = file;
    let contentType = file.type.split(";")[0];
    let ext = MIME_TO_EXT[contentType] ?? "bin";

    if (type === "photo") {
      uploadBlob = await compressImage(file);
      ext = "webp";
      contentType = "image/webp";
    }

    // Private media lives outside the habit's folder, which partners on the
    // habit can read (034); see 039.
    const path = isPrivate
      ? `${user.id}/private/${crypto.randomUUID()}.${ext}`
      : `${user.id}/${habitId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("completions")
      .upload(path, uploadBlob, { contentType });

    if (uploadError) throw uploadError;

    // Store the path — signed URLs are resolved at render time via
    // useEvidenceUrls so they never permanently expire.
    return path;
  };

  // --- Submit handlers ---

  const handleMessageSubmit = () => {
    if (!message.trim()) return;
    // Private check-ins are never queued offline (see PrivateOfflineError),
    // so say so here while the note is still on screen, rather than closing
    // the sheet and losing it.
    if (isPrivate && !navigator.onLine) {
      setError("You're offline. Private check-ins need a connection.");
      return;
    }
    setIsSubmitting(true);
    onComplete({ type: "message", notes: message.trim(), isPrivate });
    handleClose(false);
  };

  // Both the reason and the note are optional — the skip itself is the signal.
  const handleRainCheckSubmit = () => {
    setIsSubmitting(true);
    onComplete({
      type: "rain_check",
      notes: message.trim() || undefined,
      rainCheckReason: rainCheckReason ?? undefined,
      rainCheckMovedTo: rainCheckMovedTo ?? undefined,
    });
    handleClose(false);
  };

  // --- Render ---

  // The steps after the picker name themselves in the sheet's own title row,
  // beside a back arrow, rather than in a second header under it.
  const sheetTitle =
    mode === "select" ? (
      <span className="flex items-center gap-2">
        <span>{habitEmoji}</span>
        <span>Log completion</span>
      </span>
    ) : mode === "message" ? (
      "Reflection"
    ) : (
      "Rain check"
    );

  return (
    <>
      {/* Hidden file input — must live outside Sheet so it stays mounted when camera is open */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Proxy input — captures iOS keyboard within the user gesture */}
      <input
        ref={proxyInputRef}
        aria-hidden
        tabIndex={-1}
        style={{ position: "fixed", opacity: 0, left: 0, top: 0, width: 1, height: 1, padding: 0, border: "none" }}
      />

      <Sheet
        open={open && !cameraOpen && !voiceOpen}
        onOpenChange={handleClose}
        // The rain-check form is the tallest mode (reason list + note + action)
        // and is the one most likely to have the keyboard open over it.
        size={mode === "rain_check" ? "lg" : "md"}
        title={sheetTitle}
        description={mode === "select" ? habitTitle : undefined}
        onBack={mode === "select" ? undefined : () => setMode("select")}
      >
        {/* Error banner */}
        {error && <ErrorBanner message={error} className="mb-3" />}

        <>
          {/* --- Select mode --- */}
          {mode === "select" && (
            <div className="cf-fade-in grid grid-cols-2 gap-3">

              <CheckInTile
                action="content"
                title="Content"
                hint="Photo or video"
                onClick={handleContentSelect}
              />
              <CheckInTile
                action="voice"
                title="Voice"
                hint="Record a note"
                onClick={handleVoiceSelect}
              />
              <CheckInTile
                action="message"
                title="Message"
                hint="Write a note"
                onClick={handleMessageSelect}
              />
              <CheckInTile
                action="quick"
                title="Check in"
                hint="Just log it"
                onClick={handleQuickCheckin}
              />
              {allowRainCheck && (
                <CheckInTile
                  action="rain_check"
                  title="Rain check"
                  hint="Skip today, keep your streak"
                  onClick={handleRainCheckSelect}
                  wide
                />
              )}
            </div>
          )}

          {/* --- Message mode --- */}
          {mode === "message" && (
            <div className="cf-slide-in space-y-4">
              <TextArea
                ref={textareaRef}
                placeholder="How did it go?"
                value={message}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                    setMessage(e.target.value);
                  }
                }}
                rows={4}
              />
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-xs font-mono",
                    message.length >= MAX_MESSAGE_LENGTH
                      ? "text-miss-ink"
                      : "text-text-tertiary",
                  )}
                >
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
                <div className="flex items-center gap-2">
                  <PrivateToggle
                    isPrivate={isPrivate}
                    onChange={setIsPrivate}
                    disabled={isSubmitting}
                  />
                  <Button
                    onClick={handleMessageSubmit}
                    disabled={!message.trim() || isSubmitting}
                    loading={isSubmitting}
                  >
                    Submit
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* --- Rain check mode ---
              Everything on one screen of a small phone, button included:
              skip-or-move is one toggle, the reasons one row of tiles, and
              the note two lines. Picked options keep their words in the
              hour's ink; the blue lives in the wash and the border, since
              Rain Blue as small text is under 4.5:1. */}
          {mode === "rain_check" && (
            <div className="cf-slide-in space-y-3">
              <p className="text-sm text-text-secondary">
                {rainCheckMovedTo === null
                  ? "Skip today without losing your streak. Your partners will see it, so they know you haven\u2019t dropped off."
                  : `Your streak holds, and ${habitTitle} moves to ${weekdayName(rainCheckMovedTo)}. Miss it then and the streak breaks.`}
              </p>

              {/* Skip or move. Moving is a promise, not just a nicer word for
                  skipping: if the chosen day passes undone, the streak breaks. */}
              {canMove && (
                <div
                  role="radiogroup"
                  aria-label="What happens to it?"
                  className="grid grid-cols-2 gap-1 rounded-lg bg-bg-secondary p-1"
                >
                  {[
                    { moved: false, label: "Skip today", Icon: CloudRain },
                    { moved: true, label: "Move it", Icon: CornerDownRight },
                  ].map(({ moved, label, Icon }) => {
                    const selected = moved === (rainCheckMovedTo !== null);
                    return (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() =>
                          setRainCheckMovedTo(moved ? moveChoices[0].key : null)
                        }
                        className={cn(
                          RAIN_OPTION,
                          "min-h-11 gap-2 rounded-md text-sm",
                          selected ? RAIN_PICKED : "border-transparent",
                        )}
                      >
                        <Icon
                          className="w-4 h-4 shrink-0"
                          style={selected ? { color: "var(--color-rain)" } : undefined}
                          aria-hidden
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* The day, once "Move it" is picked. The days share the row
                  while each keeps a 44px target; a full week on the narrowest
                  phones scrolls sideways rather than shrinking them. */}
              {rainCheckMovedTo !== null && (
                <div
                  role="radiogroup"
                  aria-label="Which day?"
                  className="grid grid-flow-col auto-cols-[minmax(2.75rem,1fr)] gap-1.5 overflow-x-auto"
                >
                  {moveChoices.map((choice) => {
                    const selected = rainCheckMovedTo === choice.key;
                    return (
                      <button
                        key={choice.key}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={weekdayName(choice.key)}
                        onClick={() => setRainCheckMovedTo(choice.key)}
                        className={cn(
                          RAIN_OPTION,
                          "min-h-12 flex-col rounded-lg text-xs",
                          selected ? RAIN_PICKED : RAIN_UNPICKED,
                        )}
                      >
                        <span>{choice.weekday}</span>
                        <span className="font-mono">{choice.dayOfMonth}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* One row of tiles, each a 44px-plus target: the five reasons
                  took five full-width rows, most of the sheet, for an
                  optional answer. */}
              <div>
                <p
                  id="rain-check-reason-label"
                  className="text-xs font-medium text-text-secondary mb-1.5"
                >
                  Why? (optional)
                </p>
                <div
                  role="group"
                  aria-labelledby="rain-check-reason-label"
                  className="grid grid-cols-5 gap-1.5"
                >
                  {RAIN_CHECK_REASONS.map((reason) => {
                    const selected = rainCheckReason === reason.code;
                    return (
                      <button
                        key={reason.code}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setRainCheckReason(selected ? null : reason.code)
                        }
                        className={cn(
                          RAIN_OPTION,
                          "min-h-14 flex-col gap-1 rounded-lg px-0.5 text-xs leading-tight",
                          selected ? RAIN_PICKED : RAIN_UNPICKED,
                        )}
                      >
                        <reason.icon
                          className="w-5 h-5 shrink-0"
                          style={selected ? { color: "var(--color-rain)" } : undefined}
                          aria-hidden
                        />
                        <span className="max-w-full truncate">{reason.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <TextArea
                  placeholder="Add a note (optional)"
                  value={message}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                      setMessage(e.target.value);
                    }
                  }}
                  rows={2}
                />
                {/* Only near the limit: the count is noise until it matters. */}
                {message.length >= MAX_MESSAGE_LENGTH - 50 && (
                  <p
                    className={cn(
                      "mt-1 text-right text-xs font-mono",
                      message.length >= MAX_MESSAGE_LENGTH
                        ? "text-miss-ink"
                        : "text-text-tertiary",
                    )}
                  >
                    {message.length}/{MAX_MESSAGE_LENGTH}
                  </p>
                )}
              </div>

              {/* Full-width and last in the flow: the thumb-reachable position
                  on a phone, and it stays put when the keyboard opens. */}
              <Button
                className="w-full"
                size="lg"
                onClick={handleRainCheckSubmit}
                disabled={isSubmitting}
                loading={isSubmitting}
              >
                {rainCheckMovedTo === null
                  ? "Take rain check"
                  : `Move to ${weekdayName(rainCheckMovedTo)}`}
              </Button>
            </div>
          )}
        </>
      </Sheet>

      {/* Camera overlay — rendered outside Sheet so it's truly full-screen.
          Its review is where a photo or video is checked in, caption, private
          switch and all; there is no step after it. */}
      {cameraOpen && (
        <CameraCapture
          key={picked?.n ?? 0}
          initialCapture={picked ? { file: picked.file } : undefined}
          onCapture={handleCameraCapture}
          onClose={handleCameraClose}
          onFallback={handleCameraFallback}
          allowVoice={false}
          useLabel="Submit"
          privacy={{ isPrivate, onChange: setIsPrivate }}
        />
      )}

      {/* Voice recorder overlay — rendered outside Sheet so it's truly
          full-screen. Like the camera's, its review is the last step. */}
      {voiceOpen && (
        <VoiceRecorder
          onCapture={handleVoiceCapture}
          onClose={handleVoiceClose}
          privacy={{ isPrivate, onChange: setIsPrivate }}
        />
      )}
    </>
  );
}

/**
 * One way to check in, on the sheet's first step. Each wears its action's
 * own color — the same solid circle and white icon as on the habit card's
 * drawer, from the same table — so a voice note is purple and a note is
 * orange wherever you meet them. The tile behind takes a light wash of it.
 *
 * Rain check runs the full width with a dashed edge: a skip on purpose,
 * set apart from the four ways of doing it.
 */
function CheckInTile({
  action,
  title,
  hint,
  onClick,
  wide = false,
}: {
  action: CheckInAction;
  title: string;
  hint: string;
  onClick: () => void;
  wide?: boolean;
}) {
  const option = CHECK_IN_OPTIONS.find((o) => o.action === action)!;
  const Icon = option.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg transition-transform active:scale-95",
        wide
          ? "col-span-2 flex items-center gap-3 border border-dashed p-4 hover:scale-[1.01]"
          : "flex flex-col items-center gap-2 p-5 hover:scale-[1.02]",
      )}
      style={
        wide
          ? { borderColor: `color-mix(in srgb, ${option.color} 45%, transparent)` }
          : { backgroundColor: `color-mix(in srgb, ${option.color} 12%, var(--color-bg-elevated))` }
      }
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
        style={{ backgroundColor: option.color }}
      >
        <Icon className="h-5 w-5" strokeWidth={2.25} />
      </span>
      <span className={wide ? "text-left" : "text-center"}>
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="block text-xs text-text-tertiary">{hint}</span>
      </span>
    </button>
  );
}
