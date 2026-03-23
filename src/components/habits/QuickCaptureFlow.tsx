"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import { Button } from "@/components/ui/Button";
import { CameraCapture } from "@/components/habits/CameraCapture";
import { useCompleteHabit } from "@/lib/hooks/useCompleteHabit";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import { compressImage } from "@/lib/utils/compress-image";
import { cn } from "@/lib/utils/cn";
import { getBrowserTimezone } from "@/lib/utils/timezone";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  MIME_TO_EXT,
} from "@/lib/utils/media-types";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { MAX_VIDEO_SIZE_MB } from "@/lib/constants/limits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TodayHabit {
  id: string;
  title: string;
  emoji: string;
  color: string;
  streak_current: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCaptureFlow() {
  const router = useRouter();
  const { show, ToastElements } = useToast();
  const completeHabit = useCompleteHabit();

  const step = useQuickCaptureStore((s) => s.step);
  const captureMode = useQuickCaptureStore((s) => s.captureMode);
  const capturedFile = useQuickCaptureStore((s) => s.capturedFile);
  const setCapturedFile = useQuickCaptureStore((s) => s.setCapturedFile);
  const setStep = useQuickCaptureStore((s) => s.setStep);
  const close = useQuickCaptureStore((s) => s.close);
  const reset = useQuickCaptureStore((s) => s.reset);

  const [habits, setHabits] = useState<TodayHabit[]>([]);
  const [habitsLoading, setHabitsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup preview URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Generate preview when file changes
  useEffect(() => {
    if (capturedFile) {
      const url = URL.createObjectURL(capturedFile);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } else {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }, [capturedFile]);

  // Fetch today's incomplete habits when entering habit-select.
  // Uses a single RPC instead of 3 sequential client queries.
  useEffect(() => {
    if (step !== "habit-select") return;

    let cancelled = false;

    async function fetchIncompleteHabits() {
      setHabitsLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const tz = getBrowserTimezone();

        const { data, error: rpcError } = await untypedRpc<TodayHabit[]>(
          supabase,
          "get_incomplete_habits_today",
          { p_timezone: tz },
        );

        if (rpcError) throw rpcError;

        if (!cancelled) {
          setHabits(
            (data ?? []).map((h) => ({
              ...h,
              emoji: h.emoji ?? "✅",
              color: h.color ?? "#6366F1",
              streak_current: h.streak_current ?? 0,
            })),
          );
          setHabitsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load habits");
          setHabitsLoading(false);
        }
      }
    }

    fetchIncompleteHabits();
    return () => {
      cancelled = true;
    };
  }, [step]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCameraCapture = useCallback(
    (file: File, captionNotes?: string) => {
      // Detect mode from file type
      const mode = file.type.startsWith("video") ? "video" : "photo";
      useQuickCaptureStore.setState({ captureMode: mode });
      setCapturedFile(file);
      if (captionNotes) setNotes(captionNotes);
    },
    [setCapturedFile],
  );

  const handleCameraFallback = useCallback(() => {
    // Camera unavailable — open file picker as fallback
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (
        !ALLOWED_IMAGE_TYPES.has(file.type) &&
        !ALLOWED_VIDEO_TYPES.has(file.type)
      ) {
        setError(
          "Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.",
        );
        return;
      }

      if (
        ALLOWED_VIDEO_TYPES.has(file.type) &&
        file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024
      ) {
        setError(`Video must be under ${MAX_VIDEO_SIZE_MB}MB`);
        return;
      }

      const mode = ALLOWED_VIDEO_TYPES.has(file.type) ? "video" : "photo";
      useQuickCaptureStore.setState({ captureMode: mode });
      setCapturedFile(file);
    },
    [setCapturedFile],
  );

  const handleHabitSelect = useCallback(
    async (habitId: string) => {
      if (!capturedFile || !captureMode) return;

      setStep("uploading");
      setError(null);

      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        let uploadBlob: Blob = capturedFile;
        let ext = MIME_TO_EXT[capturedFile.type] ?? "bin";
        let contentType = capturedFile.type;

        if (captureMode === "photo") {
          uploadBlob = await compressImage(capturedFile);
          ext = "webp";
          contentType = "image/webp";
        }

        const path = `${user.id}/${habitId}/${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("completions")
          .upload(path, uploadBlob, { contentType });

        if (uploadError) throw uploadError;

        // Store the path — signed URLs are resolved at render time
        await completeHabit.mutateAsync({
          habitId,
          type: captureMode,
          evidenceUrl: path,
          notes: notes.trim() || undefined,
        });

        show({ title: "Habit completed!", variant: "success" });
        router.refresh();
        reset();
      } catch (err) {
        console.error("Quick capture upload failed:", err);
        show({ title: "Upload failed. Try again.", variant: "error" });
        setStep("habit-select");
      }
    },
    [
      capturedFile,
      captureMode,
      completeHabit,
      notes,
      reset,
      router,
      setStep,
      show,
    ],
  );

  const handleClose = useCallback(() => {
    close();
    setError(null);
    setHabits([]);
    setNotes("");
  }, [close]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (step === "closed") return <>{ToastElements}</>;

  return (
    <>
      {/* Hidden file input for camera fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Camera - full screen (Snapchat-style: tap for photo, hold for video) */}
      {step === "camera" && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={handleClose}
          onFallback={handleCameraFallback}
        />
      )}

      {/* Habit Selection — full-screen solid panel */}
      {step === "habit-select" && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
          <div className="flex items-center justify-between p-4">
            <h2 className="font-display text-lg font-semibold text-text-primary">
              Log to habit
            </h2>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-text-secondary" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-8">
            {/* Thumbnail preview */}
            {previewUrl && captureMode && (
              <div className="mb-4 rounded-xl overflow-hidden bg-bg-secondary max-h-40 flex items-center justify-center">
                {captureMode === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Captured"
                    className="w-full max-h-40 object-contain"
                  />
                ) : (
                  <video
                    src={previewUrl}
                    className="w-full max-h-40 object-contain"
                    playsInline
                    muted
                  />
                )}
              </div>
            )}

            {/* Caption / notes */}
            <div className="mb-4">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a caption (optional)"
                className={cn(
                  "w-full rounded-lg border px-4 py-2.5 text-base transition-colors",
                  "bg-bg-secondary border-surface-hover",
                  "text-text-primary placeholder-text-tertiary",
                  "focus:outline-none focus:ring-2 focus:ring-brand",
                )}
              />
            </div>

            {error && <ErrorBanner message={error} className="mb-3" />}

            {habitsLoading ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <Loader2 className="w-6 h-6 animate-spin text-brand" />
                <p className="text-sm text-text-secondary">Loading habits...</p>
              </div>
            ) : habits.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <p className="text-sm text-text-secondary">
                  All done for today!
                </p>
                <Button variant="secondary" onClick={handleClose}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {habits.map((habit) => (
                  <button
                    key={habit.id}
                    type="button"
                    onClick={() => handleHabitSelect(habit.id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-4 rounded-xl transition-all",
                      "bg-bg-secondary hover:bg-surface-hover active:scale-[0.98]",
                      "border-l-[3px]",
                    )}
                    style={{
                      borderLeftColor: habit.color || "var(--color-brand)",
                    }}
                  >
                    <span className="text-xl shrink-0">{habit.emoji}</span>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {habit.title}
                      </p>
                    </div>
                    {habit.streak_current > 0 && (
                      <span className="text-xs font-mono text-streak shrink-0">
                        {habit.streak_current}d
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uploading overlay */}
      {step === "uploading" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-bg-elevated p-8 shadow-lg">
            <Loader2 className="w-8 h-8 animate-spin text-brand" />
            <p className="text-sm font-medium text-text-primary">
              Uploading...
            </p>
          </div>
        </div>
      )}

      {ToastElements}
    </>
  );
}
