"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Camera,
  Check,
  CloudRain,
  CornerDownRight,
  MessageSquare,
  Loader2,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { createClient } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import { compressImage } from "@/lib/utils/compress-image";
import { ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES, MIME_TO_EXT } from "@/lib/utils/media-types";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { ModeHeader } from "@/components/ui/ModeHeader";

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

type Mode = "select" | "content" | "message" | "rain_check";

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
  onComplete: (params: {
    type: CompletionType;
    evidenceUrl?: string;
    notes?: string;
    rainCheckReason?: RainCheckReason;
    /** The day a rain check was moved to, as a YYYY-MM-DD key. */
    rainCheckMovedTo?: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import {
  MAX_MESSAGE_LENGTH,
  MAX_IMAGE_SIZE_MB,
  MAX_VIDEO_SIZE_MB,
} from "@/lib/constants/limits";
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
  onComplete,
}: CompletionFormProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [rainCheckReason, setRainCheckReason] =
    useState<RainCheckReason | null>(null);
  // null = a plain skip. A date key = "I'll do it that day instead", which
  // turns the skip into a promise the streak logic will hold you to.
  const [rainCheckMovedTo, setRainCheckMovedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Proxy input: on iOS, the keyboard only opens when focus occurs
  // synchronously inside a user-gesture handler. Since the TextArea doesn't
  // exist yet when "Message" is tapped, we focus this invisible proxy first,
  // then transfer focus once the TextArea mounts.
  const proxyInputRef = useRef<HTMLInputElement>(null);

  // Derive media type from selected file
  const mediaType: "photo" | "video" | null = selectedFile
    ? selectedFile.type.startsWith("video")
      ? "video"
      : "photo"
    : null;

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

  // Jump straight to the step the habit card asked for. Deliberately keyed on
  // `open` alone: re-running it would drag the user back here after they hit
  // "back", or reopen a camera they just dismissed.
  useEffect(() => {
    if (!open || !initialAction) return;
    if (initialAction === "content") {
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

  // Cleanup preview URL on unmount or when changing
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const reset = () => {
    setMode("select");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setSelectedFile(null);
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

  const handleCameraCapture = (file: File) => {
    setCameraOpen(false);
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setMode("content");
  };

  const handleCameraFallback = () => {
    // Don't close camera here — Radix Dialog's focus management will
    // dismiss the native file picker if the Sheet re-opens. Leave camera
    // open behind the picker; it closes when a file is selected.
    fileInputRef.current?.click();
  };

  const handleCameraClose = () => {
    setCameraOpen(false);
  };

  // --- Voice capture handlers ---

  const handleVoiceCapture = async (file: File) => {
    setVoiceOpen(false);
    setIsSubmitting(true);
    setError(null);
    try {
      const url = await uploadFile(file, "voice");
      onComplete({ type: "voice", evidenceUrl: url });
      handleClose(false);
    } catch (err) {
      console.error("Voice upload failed:", err);
      setError("Upload failed. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleVoiceClose = () => {
    setVoiceOpen(false);
  };

  // --- File handling ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type) && !ALLOWED_VIDEO_TYPES.has(file.type)) {
      setError("Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.");
      return;
    }

    if (
      ALLOWED_IMAGE_TYPES.has(file.type) &&
      file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024
    ) {
      setError(`Image must be under ${MAX_IMAGE_SIZE_MB}MB`);
      return;
    }

    if (
      ALLOWED_VIDEO_TYPES.has(file.type) &&
      file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024
    ) {
      setError(`Video must be under ${MAX_VIDEO_SIZE_MB}MB`);
      return;
    }

    // Close camera overlay if it was open (fallback flow)
    setCameraOpen(false);
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setMode("content");
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

    let uploadBlob: Blob = file;
    let contentType = file.type;

    let ext = MIME_TO_EXT[file.type] ?? "bin";

    if (type === "photo") {
      uploadBlob = await compressImage(file);
      ext = "webp";
      contentType = "image/webp";
    }

    const path = `${user.id}/${habitId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("completions")
      .upload(path, uploadBlob, { contentType });

    if (uploadError) throw uploadError;

    // Store the path — signed URLs are resolved at render time via
    // useEvidenceUrls so they never permanently expire.
    return path;
  };

  // --- Submit handlers ---

  const handleContentSubmit = async () => {
    if (!selectedFile || !mediaType) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const url = await uploadFile(selectedFile, mediaType);
      onComplete({ type: mediaType, evidenceUrl: url });
      handleClose(false);
    } catch (err) {
      console.error("Upload failed:", err);
      setError("Upload failed. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleMessageSubmit = () => {
    if (!message.trim()) return;
    setIsSubmitting(true);
    onComplete({ type: "message", notes: message.trim() });
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

  const sheetTitle =
    mode === "select" ? (
      <span className="flex items-center gap-2">
        <span>{habitEmoji}</span>
        <span>Log completion</span>
      </span>
    ) : undefined;

  const isPhoto = mediaType === "photo";

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
      >
        {/* Error banner */}
        {error && <ErrorBanner message={error} className="mb-3" />}

        <>
          {/* --- Select mode --- */}
          {mode === "select" && (
            <div className="cf-fade-in grid grid-cols-2 gap-3">

              <button
                type="button"
                onClick={handleContentSelect}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-lg transition-all",
                  "hover:scale-[1.02] active:scale-95",
                )}
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-brand) 15%, var(--color-bg-secondary))",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-brand) 15%, transparent)",
                  }}
                >
                  <Camera
                    className="w-5 h-5"
                    style={{ color: "var(--color-brand)" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-text-primary">
                    Content
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Photo or video
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={handleVoiceSelect}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-lg transition-all",
                  "hover:scale-[1.02] active:scale-95",
                )}
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-encourage) 15%, var(--color-bg-secondary))",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-encourage) 15%, transparent)",
                  }}
                >
                  <Mic
                    className="w-5 h-5"
                    style={{ color: "var(--color-encourage)" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-text-primary">
                    Voice
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Record a note
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={handleMessageSelect}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-lg transition-all",
                  "hover:scale-[1.02] active:scale-95",
                )}
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-streak) 15%, var(--color-bg-secondary))",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-streak) 15%, transparent)",
                  }}
                >
                  <MessageSquare
                    className="w-5 h-5"
                    style={{ color: "var(--color-streak)" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-text-primary">
                    Message
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Write a note
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={handleQuickCheckin}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-lg transition-all",
                  "hover:scale-[1.02] active:scale-95",
                )}
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-success) 15%, var(--color-bg-secondary))",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-success) 15%, transparent)",
                  }}
                >
                  <Check
                    className="w-5 h-5"
                    style={{ color: "var(--color-success)" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-text-primary">
                    Check in
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Just log it
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={handleRainCheckSelect}
                className={cn(
                  "col-span-2 flex items-center gap-3 p-4 rounded-lg transition-all",
                  "border border-dashed hover:scale-[1.01] active:scale-95",
                )}
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--color-rain) 40%, transparent)",
                }}
              >
                <div
                  className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-rain) 15%, transparent)",
                  }}
                >
                  <CloudRain
                    className="w-5 h-5"
                    style={{ color: "var(--color-rain)" }}
                  />
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-text-primary">
                    Rain check
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Skip today, keep your streak
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* --- Content review mode (photo/video) --- */}
          {mode === "content" && (
            <div className="cf-slide-in space-y-4">

              <ModeHeader
                label={isPhoto ? "Photo proof" : "Video proof"}
                onBack={() => {
                  setMode("select");
                  setSelectedFile(null);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                }}
              />
              {preview && (
                <div className="relative rounded-lg overflow-hidden bg-bg-secondary">
                  {isPhoto ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={preview}
                      alt="Photo preview"
                      className="w-full max-h-64 object-contain"
                    />
                  ) : (
                    <video
                      src={preview}
                      controls
                      className="w-full max-h-64"
                      playsInline
                    />
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    if (isCameraSupported()) {
                      setCameraOpen(true);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  disabled={isSubmitting}
                >
                  Change
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleContentSubmit}
                  loading={isSubmitting}
                  disabled={!selectedFile || isSubmitting}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}

          {/* --- Message mode --- */}
          {mode === "message" && (
            <div className="cf-slide-in space-y-4">

              <ModeHeader label="Reflection" onBack={() => setMode("select")} />
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
                      ? "text-miss"
                      : "text-text-tertiary",
                  )}
                >
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
                <Button
                  onClick={handleMessageSubmit}
                  disabled={!message.trim() || isSubmitting}
                  loading={isSubmitting}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}

          {/* --- Rain check mode --- */}
          {mode === "rain_check" && (
            <div className="cf-slide-in space-y-4">

              <ModeHeader label="Rain check" onBack={() => setMode("select")} />

              <p className="text-sm text-text-secondary">
                {rainCheckMovedTo === null
                  ? "Skip today without losing your streak. Your partners will see it, so they know you haven’t dropped off."
                  : `Your streak holds, and ${habitTitle} moves to ${weekdayName(rainCheckMovedTo)}. Miss it then and the streak breaks.`}
              </p>

              {/* Skip or move. Moving is a promise, not just a nicer word for
                  skipping: if the chosen day passes undone, the streak breaks.
                  It leads because it is the choice that changes what happens;
                  the reason below is optional context. Same full-width row
                  treatment as the reason list. */}
              {canMove && (
              <div>
                <p
                  id="rain-check-plan-label"
                  className="text-xs font-medium text-text-secondary mb-2"
                >
                  What happens to it?
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="rain-check-plan-label"
                  className="space-y-1.5"
                >
                  {[
                    { moved: false, label: "Just skip today" },
                    { moved: true, label: "Move it to another day" },
                  ].map((option) => {
                    const selected = option.moved === (rainCheckMovedTo !== null);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() =>
                          setRainCheckMovedTo(
                            option.moved ? moveChoices[0].key : null,
                          )
                        }
                        className={cn(
                          "w-full min-h-12 flex items-center gap-3 rounded-lg px-3 py-3",
                          "border text-left text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                          selected
                            ? "font-medium"
                            : "border-[var(--color-surface-hover)] text-text-secondary hover:bg-surface-hover",
                        )}
                        style={
                          selected
                            ? {
                              color: "var(--color-rain)",
                              borderColor: "var(--color-rain)",
                              backgroundColor:
                                "color-mix(in srgb, var(--color-rain) 12%, transparent)",
                            }
                            : undefined
                        }
                      >
                        {option.moved ? (
                          <CornerDownRight className="w-5 h-5 shrink-0" />
                        ) : (
                          <CloudRain className="w-5 h-5 shrink-0" />
                        )}
                        <span className="flex-1 min-w-0 truncate">
                          {option.label}
                        </span>
                        {selected && (
                          <Check className="w-4 h-4 shrink-0" strokeWidth={3} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Day picker, only once "move" is chosen. Scrolls rather than
                  wraps so the row height stays fixed as the sheet grows. */}
              {rainCheckMovedTo !== null && (
                <div>
                  <p
                    id="rain-check-day-label"
                    className="text-xs font-medium text-text-secondary mb-2"
                  >
                    Which day?
                  </p>
                  <div
                    role="radiogroup"
                    aria-labelledby="rain-check-day-label"
                    className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4"
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
                            "shrink-0 w-12 min-h-12 flex flex-col items-center justify-center",
                            "rounded-lg border text-xs transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                            selected
                              ? "font-semibold"
                              : "border-[var(--color-surface-hover)] text-text-secondary hover:bg-surface-hover",
                          )}
                          style={
                            selected
                              ? {
                                color: "var(--color-rain)",
                                borderColor: "var(--color-rain)",
                                backgroundColor:
                                  "color-mix(in srgb, var(--color-rain) 12%, transparent)",
                              }
                              : undefined
                          }
                        >
                          <span>{choice.weekday}</span>
                          <span className="font-mono">{choice.dayOfMonth}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Single-select list rather than wrapped chips: full-width rows
                  give a 48px tap target, stay legible at any width, and read
                  the way a picker does on both iOS and Android. */}
              <div>
                <p
                  id="rain-check-reason-label"
                  className="text-xs font-medium text-text-secondary mb-2"
                >
                  Why? (optional)
                </p>
                <div
                  role="group"
                  aria-labelledby="rain-check-reason-label"
                  className="space-y-1.5"
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
                          "w-full min-h-12 flex items-center gap-3 rounded-lg px-3 py-3",
                          "border text-left text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                          selected
                            ? "font-medium"
                            : "border-[var(--color-surface-hover)] text-text-secondary hover:bg-surface-hover",
                        )}
                        style={
                          selected
                            ? {
                              color: "var(--color-rain)",
                              borderColor: "var(--color-rain)",
                              backgroundColor:
                                "color-mix(in srgb, var(--color-rain) 12%, transparent)",
                            }
                            : undefined
                        }
                      >
                        <reason.icon className="w-5 h-5 shrink-0" />
                        <span className="flex-1 min-w-0 truncate">
                          {reason.label}
                        </span>
                        {selected && (
                          <Check className="w-4 h-4 shrink-0" strokeWidth={3} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <TextArea
                placeholder="Add a note (optional)"
                value={message}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                    setMessage(e.target.value);
                  }
                }}
                rows={3}
              />

              <div className="flex justify-end">
                <span
                  className={cn(
                    "text-xs font-mono",
                    message.length >= MAX_MESSAGE_LENGTH
                      ? "text-miss"
                      : "text-text-tertiary",
                  )}
                >
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
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

        {/* Loading overlay */}
        {isSubmitting && mode !== "message" && mode !== "rain_check" && (
          <div className="absolute inset-0 flex items-center justify-center bg-elevated/80 rounded-t-lg z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p className="text-sm text-text-secondary">
                Uploading...
              </p>
            </div>
          </div>
        )}
      </Sheet>

      {/* Camera overlay — rendered outside Sheet so it's truly full-screen */}
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={handleCameraClose}
          onFallback={handleCameraFallback}
        />
      )}

      {/* Voice recorder overlay — rendered outside Sheet so it's truly full-screen */}
      {voiceOpen && (
        <VoiceRecorder
          onCapture={handleVoiceCapture}
          onClose={handleVoiceClose}
        />
      )}
    </>
  );
}
