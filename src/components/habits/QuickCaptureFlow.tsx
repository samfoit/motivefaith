"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DASHBOARD_KEY_PREFIX } from "@/lib/hooks/useDashboard";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import { Button } from "@/components/ui/Button";
import dynamic from "next/dynamic";
import { useShareCapture } from "@/lib/hooks/useShareCapture";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import { useFriendsList } from "@/lib/hooks/useFriends";
import { useGroupsList } from "@/lib/hooks/useGroups";
import {
  ShareTargetPicker,
  SelectedTargets,
  type PickerHabit,
} from "@/components/habits/ShareTargetPicker";
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

/**
 * Interaction-only: the camera UI is reachable only after the user taps the
 * capture button, but this component is mounted by the authenticated layout on
 * every screen. Importing it statically put its dependencies — motion/react
 * among them, ~113KB — on the critical path of every page for a surface most
 * page views never open. There is no `loading` fallback because the camera
 * already opens into a full-screen surface of its own.
 */
const CameraCapture = dynamic(
  () =>
    import("@/components/habits/CameraCapture").then((m) => m.CameraCapture),
  { loading: () => null },
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { MAX_VIDEO_SIZE_MB } from "@/lib/constants/limits";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCaptureFlow() {
  const queryClient = useQueryClient();
  const { show, ToastElements } = useToast();
  const shareCapture = useShareCapture();
  const userId = useAuthUserId() ?? undefined;

  const step = useQuickCaptureStore((s) => s.step);
  const captureMode = useQuickCaptureStore((s) => s.captureMode);
  const capturedFile = useQuickCaptureStore((s) => s.capturedFile);
  const setCapturedFile = useQuickCaptureStore((s) => s.setCapturedFile);
  const setStep = useQuickCaptureStore((s) => s.setStep);
  const close = useQuickCaptureStore((s) => s.close);
  const reset = useQuickCaptureStore((s) => s.reset);
  const backToPreview = useQuickCaptureStore((s) => s.backToPreview);
  const habitIds = useQuickCaptureStore((s) => s.habitIds);
  const friendIds = useQuickCaptureStore((s) => s.friendIds);
  const groupIds = useQuickCaptureStore((s) => s.groupIds);
  const toggleTarget = useQuickCaptureStore((s) => s.toggleTarget);

  // Only fetched once the flow is open; both are cached across opens.
  const { data: friends } = useFriendsList(step !== "closed" ? userId : undefined);
  const { data: groups } = useGroupsList(step !== "closed" ? userId : undefined);

  const pickerFriends = useMemo(
    () => (friends ?? []).map((f) => f.profile),
    [friends],
  );
  const pickerGroups = useMemo(
    () =>
      (groups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        avatar_url: g.avatar_url,
        memberCount: g.memberCount,
      })),
    [groups],
  );
  const selected = useMemo(
    () => ({ habit: habitIds, friend: friendIds, group: groupIds }),
    [habitIds, friendIds, groupIds],
  );

  const [habits, setHabits] = useState<PickerHabit[]>([]);
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

  // Fetch today's incomplete habits when entering the share step.
  // Uses a single RPC instead of 3 sequential client queries.
  useEffect(() => {
    if (step !== "share") return;

    let canceled = false;

    async function fetchIncompleteHabits() {
      setHabitsLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const tz = getBrowserTimezone();

        const { data, error: rpcError } = await untypedRpc<PickerHabit[]>(
          supabase,
          "get_incomplete_habits_today",
          { p_timezone: tz },
        );

        if (rpcError) throw rpcError;

        if (!canceled) {
          // Rows come back exactly as the dashboard card draws them: no
          // made-up emoji or color for a habit that has none.
          setHabits(data ?? []);
          setHabitsLoading(false);
        }
      } catch {
        if (!canceled) {
          setError("Failed to load habits");
          setHabitsLoading(false);
        }
      }
    }

    fetchIncompleteHabits();
    return () => {
      canceled = true;
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
      // Always overwrite: clearing the caption on the preview must stick.
      setNotes(captionNotes ?? "");
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

  const selectedCount = habitIds.length + friendIds.length + groupIds.length;

  const handleSend = useCallback(async () => {
    if (!capturedFile || !captureMode || selectedCount === 0) return;

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

      // Uploaded once; every destination row points at this path, and those
      // rows are what let a friend or group member read it (migration 034).
      const path = `${user.id}/capture/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("completions")
        .upload(path, uploadBlob, { contentType });

      if (uploadError) throw uploadError;

      await shareCapture.mutateAsync({
        mediaPath: path,
        mediaType: captureMode,
        caption: notes.trim() || undefined,
        habitIds,
        friendIds,
        groupIds,
      });

      show({
        title: habitIds.length > 0 && selectedCount === habitIds.length
          ? "Habit completed!"
          : "Sent!",
        variant: "success",
      });
      // The dashboard reads from the query cache now, not from server props,
      // so router.refresh() would be a wasted round trip — and one that
      // fails outright offline.
      if (habitIds.length > 0) {
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
      }
      setNotes("");
      reset();
    } catch (err) {
      console.error("Quick capture send failed:", err);
      show({ title: "Couldn't send. Try again.", variant: "error" });
      setStep("share");
    }
  }, [
    capturedFile,
    captureMode,
    selectedCount,
    shareCapture,
    notes,
    habitIds,
    friendIds,
    groupIds,
    reset,
    queryClient,
    setStep,
    show,
  ]);

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
          initialCapture={
            capturedFile
              ? { file: capturedFile, notes: notes || undefined }
              : undefined
          }
        />
      )}

      {/* Send to… — full-screen solid panel */}
      {step === "share" && (
        <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
          {/* Back goes to the full-size preview, not out of the flow — the
              preview's own ✕ is the way to discard the take. */}
          <div className="flex items-center gap-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
            <button
              type="button"
              onClick={backToPreview}
              className="p-2.5 -ml-2.5 rounded-lg hover:bg-surface-hover transition-colors"
              aria-label="Back to preview"
            >
              <ChevronLeft className="w-6 h-6 text-text-primary" />
            </button>
            <h2 className="font-display text-lg font-semibold text-text-primary">
              Send to…
            </h2>
          </div>

          {/* One scroll container for everything; the picker's search and
              tabs stick to its top. */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
            {/* Thumbnail beside the caption, so the list starts high on a
                phone screen instead of below a tall preview. */}
            <div className="flex items-center gap-3 mb-3">
              {previewUrl && captureMode && (
                <button
                  type="button"
                  onClick={backToPreview}
                  aria-label="View full preview"
                  className="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-bg-secondary active:scale-95 transition-transform"
                >
                  {captureMode === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Captured"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <video
                      src={previewUrl}
                      className="w-full h-full object-cover"
                      playsInline
                      muted
                    />
                  )}
                </button>
              )}
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a caption (optional)"
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={cn(
                  "flex-1 min-w-0 rounded-lg border px-4 py-2.5 text-base transition-colors",
                  "bg-bg-secondary border-surface-hover",
                  "text-text-primary placeholder-text-tertiary",
                  "focus:outline-none focus:ring-2 focus:ring-brand",
                )}
              />
            </div>

            {error && <ErrorBanner message={error} className="mb-3" />}

            <ShareTargetPicker
              habits={habits}
              habitsLoading={habitsLoading}
              friends={pickerFriends}
              groups={pickerGroups}
              selected={selected}
              onToggle={toggleTarget}
            />
          </div>

          <div className="border-t border-surface-hover bg-bg-primary px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SelectedTargets
              habits={habits}
              friends={pickerFriends}
              groups={pickerGroups}
              selected={selected}
              onToggle={toggleTarget}
            />
            <Button
              className="w-full min-h-12"
              disabled={selectedCount === 0}
              onClick={handleSend}
            >
              <Send className="inline w-4 h-4 mr-2 -mt-0.5" aria-hidden />
              {selectedCount === 0
                ? "Pick where to send it"
                : `Send to ${selectedCount}`}
            </Button>
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
