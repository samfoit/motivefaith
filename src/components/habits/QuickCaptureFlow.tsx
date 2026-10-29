"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { DASHBOARD_KEY_PREFIX, dashboardKey } from "@/lib/hooks/useDashboard";
import { ChevronLeft, Loader2, Mic, Send } from "lucide-react";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import { Button } from "@/components/ui/Button";
import dynamic from "next/dynamic";
import {
  useShareCapture,
  type ShareCaptureParams,
} from "@/lib/hooks/useShareCapture";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import { useConfirmSharing } from "@/lib/hooks/useConfirmSharing";
import { useOnline } from "@/lib/hooks/useOnline";
import { useFriendsList } from "@/lib/hooks/useFriends";
import { useGroupsList } from "@/lib/hooks/useGroups";
import type { DashboardData } from "@/lib/data/dashboard";
import { applyCompletion } from "@/lib/data/dashboard-mutations";
import { habitsDueToday } from "@/lib/data/capture-habits";
import { isOfflineError, queueCaptureShare } from "@/lib/offline-write";
import { notifyPendingChanged } from "@/lib/outbox-drain";
import {
  ShareTargetPicker,
  SelectedTargets,
  reachedByHabits,
  type PickerHabit,
} from "@/components/habits/ShareTargetPicker";
import type { ShareTarget } from "@/lib/stores/quick-capture-store";
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
import { checkVideo, isUploadTooLarge } from "@/lib/utils/check-video";
import { isHabitPausedError } from "@/lib/constants/completion";
import { PrivateToggle } from "@/components/habits/PrivateToggle";

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

/**
 * The picker's last list from the server, kept in the persisted cache for
 * offline: the dashboard's data stands in for it then, but doesn't know who
 * each habit's check-in reaches.
 */
function captureHabitsKey(userId: string | undefined): QueryKey {
  return ["capture-habits", userId ?? null];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCaptureFlow() {
  const queryClient = useQueryClient();
  const { show, ToastElements } = useToast();
  const shareCapture = useShareCapture();
  const confirmSharing = useConfirmSharing();
  const userId = useAuthUserId() ?? undefined;
  const online = useOnline();

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
  const deselectTargets = useQuickCaptureStore((s) => s.deselectTargets);
  const direct = useQuickCaptureStore((s) => s.direct);
  const privateOverride = useQuickCaptureStore((s) => s.privateOverride);
  const setPrivateOverride = useQuickCaptureStore((s) => s.setPrivateOverride);

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
  const [habitsUnavailable, setHabitsUnavailable] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an object URL is a browser resource; it must be made and revoked outside render.
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

  // Fetch today's habits when entering the share step — done ones too, after
  // the rest: a take can go to a habit already checked in today.
  // Uses a single RPC instead of 3 sequential client queries.
  useEffect(() => {
    if (step !== "share") return;

    let canceled = false;

    async function fetchTodaysHabits() {
      setHabitsLoading(true);
      setHabitsUnavailable(null);

      let rows: PickerHabit[] | null = null;
      let failure: unknown = null;
      try {
        const supabase = createClient();
        const tz = getBrowserTimezone();

        const { data, error: rpcError } = await untypedRpc<PickerHabit[]>(
          supabase,
          "get_habits_due_today",
          { p_timezone: tz },
        );

        if (rpcError) throw rpcError;
        rows = data ?? [];
      } catch (err) {
        failure = err;
      }
      if (canceled) return;

      if (rows) {
        // Rows come back exactly as the dashboard card draws them: no
        // made-up emoji or color for a habit that has none.
        setHabits(rows);
        queryClient.setQueryData(captureHabitsKey(userId), rows);
      } else {
        // Offline, or the server couldn't answer: today's habits as the
        // cached dashboard has them, so the take can still go to one.
        const cached = queryClient.getQueryData<DashboardData>(
          dashboardKey(userId ?? null),
        );
        if (cached) {
          setHabits(
            habitsDueToday(
              cached,
              queryClient.getQueryData<PickerHabit[]>(captureHabitsKey(userId)),
            ),
          );
        } else {
          setHabits([]);
          setHabitsUnavailable(
            isOfflineError(failure)
              ? "Your habits need a connection."
              : "Couldn't load your habits.",
          );
        }
      }
      setHabitsLoading(false);
    }

    fetchTodaysHabits();
    return () => {
      canceled = true;
    };
  }, [step, queryClient, userId]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Uploads the take once and sends it everywhere picked — or, without a
   * connection, keeps it to send once there is one. A failure goes back to
   * where the targets were chosen: the picker, or for a chat's own camera,
   * the preview with its Send button.
   */
  const send = useCallback(
    async (
      file: File,
      mode: "photo" | "video" | "voice",
      caption: string,
      targets: { habitIds: string[]; friendIds: string[]; groupIds: string[] },
      isPrivate = false,
    ) => {
      const direct = useQuickCaptureStore.getState().direct;
      setStep("uploading");

      try {
        // From the session cookie, which needs no network; storage and
        // share_capture both check the path's folder against the real
        // session, so a wrong one is refused there.
        if (!userId) throw new Error("Not authenticated");

        // The bare type: a recorder's "video/webm;codecs=vp9" is neither in
        // MIME_TO_EXT nor in the bucket's allowed types.
        let uploadBlob: Blob = file;
        let contentType = file.type.split(";")[0];
        let ext = MIME_TO_EXT[contentType] ?? "bin";

        if (mode === "photo") {
          uploadBlob = await compressImage(file);
          ext = "webp";
          contentType = "image/webp";
        }

        // Uploaded once; every destination row points at this path, and those
        // rows are what let a friend or group member read it (migration 034).
        // A private take goes where no shared row can point (039). Minted
        // before anything is sent, so a take that has to be queued keeps the
        // path it may already have reached storage under.
        const id = crypto.randomUUID();
        const share: ShareCaptureParams = {
          mediaPath: `${userId}/${isPrivate ? "private" : "capture"}/${id}.${ext}`,
          mediaType: mode,
          caption: caption.trim() || undefined,
          ...targets,
          isPrivate,
        };

        // Offline it is kept without trying, as a check-in is, and so is a
        // send the connection drops partway. A refusal from the server is
        // still an error to show, not a promise to send later.
        let queued = !navigator.onLine;
        if (!queued) {
          try {
            const { error: uploadError } = await createClient()
              .storage.from("completions")
              .upload(share.mediaPath, uploadBlob, { contentType });

            if (uploadError) throw uploadError;

            await shareCapture.mutateAsync(share);
          } catch (err) {
            if (!isOfflineError(err)) throw err;
            queued = true;
          }
        }

        const { habitIds } = targets;
        if (queued) {
          await queueCaptureShare({
            id,
            userId,
            payload: { ...share, media: await uploadBlob.arrayBuffer(), contentType },
          });
          notifyPendingChanged();
          // Checked in on the dashboard now, as an offline quick check-in
          // is, so the habit doesn't look undone while the take waits.
          if (habitIds.length > 0) {
            const key = dashboardKey(userId);
            void queryClient.cancelQueries({ queryKey: key });
            queryClient.setQueryData<DashboardData>(key, (old) =>
              habitIds.reduce(
                (data, habitId) =>
                  applyCompletion(data, {
                    habitId,
                    tempId: `${id}:${habitId}`,
                    type: mode,
                  }),
                old,
              ),
            );
          }
          // Said from a chat's camera too: the chat can't show the take
          // until it has been sent. And no onSent — that refreshes the chat
          // from a server that doesn't have it yet, and fails offline.
          show({
            title: "Saved",
            description: "It'll send when you're back online.",
            variant: "info",
          });
        } else {
          const count =
            habitIds.length + targets.friendIds.length + targets.groupIds.length;
          // From a chat's own camera the take shows up in that chat, which is
          // confirmation enough; a toast over it would only cover it. From the
          // picker it goes somewhere you can't see, so it's said.
          if (!direct) {
            show({
              title:
                habitIds.length > 0 && count === habitIds.length
                  ? "Habit completed!"
                  : "Sent!",
              variant: "success",
            });
          }
          // The dashboard reads from the query cache now, not from server props,
          // so router.refresh() would be a wasted round trip — and one that
          // fails outright offline.
          if (habitIds.length > 0) {
            void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
          }
          direct?.onSent?.();
        }
        setNotes("");
        reset();
      } catch (err) {
        console.error("Quick capture send failed:", err);
        show({
          title: isUploadTooLarge(err)
            ? "That file is too large to send."
            : isHabitPausedError(err)
              ? "A habit you picked is paused. Resume it to send it there."
              : "Couldn't send. Try again.",
          variant: "error",
        });
        setStep(direct ? "camera" : "share");
      }
    },
    [shareCapture, reset, queryClient, setStep, show, userId],
  );

  /**
   * A take from the camera or the file picker. It goes to the "Send to…"
   * picker, or, when the camera was opened from a chat, straight to that chat.
   */
  const acceptTake = useCallback(
    (file: File, mode: "photo" | "video" | "voice", caption: string) => {
      // Always overwrite: clearing the caption on the preview must stick.
      setNotes(caption);
      const direct = useQuickCaptureStore.getState().direct;
      if (!direct) {
        useQuickCaptureStore.setState({ captureMode: mode });
        setCapturedFile(file);
        return;
      }
      // Kept in the store so a failed send reopens on this take's preview.
      useQuickCaptureStore.setState({ captureMode: mode, capturedFile: file });
      void send(file, mode, caption, {
        habitIds: [],
        friendIds: direct.kind === "friend" ? [direct.id] : [],
        groupIds: direct.kind === "group" ? [direct.id] : [],
      });
    },
    [setCapturedFile, send],
  );

  const handleCameraCapture = useCallback(
    (file: File, captionNotes?: string) => {
      // Detect mode from file type
      const mode = file.type.startsWith("video")
        ? "video"
        : file.type.startsWith("audio")
          ? "voice"
          : "photo";
      acceptTake(file, mode, captionNotes ?? "");
    },
    [acceptTake],
  );

  const handleCameraFallback = useCallback(() => {
    // Camera unavailable — open file picker as fallback
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      // A toast, not the error banner: this picker is opened from the
      // camera's "unavailable" screen, and the banner is on the send screen.
      const refuse = (title: string) =>
        show({ title, variant: "error", duration: 6000 });

      const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
      if (!ALLOWED_IMAGE_TYPES.has(file.type) && !isVideo) {
        refuse("Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.");
        return;
      }

      if (isVideo) {
        const problem = await checkVideo(file);
        if (problem) {
          refuse(problem);
          return;
        }
      }

      acceptTake(file, isVideo ? "video" : "photo", "");
    },
    [acceptTake, show],
  );

  const selectedCount = habitIds.length + friendIds.length + groupIds.length;

  // Private only means anything for habits alone: a friend or group picked is
  // someone it is being sent to. Untouched, it follows the picked habits —
  // private when every one of them keeps its check-ins private.
  const onlyHabits =
    habitIds.length > 0 && friendIds.length === 0 && groupIds.length === 0;
  const habitsDefaultPrivate =
    habitIds.length > 0 &&
    habitIds.every((id) => habits.find((h) => h.id === id)?.private_checkins);
  const isPrivate = onlyHabits && (privateOverride ?? habitsDefaultPrivate);

  const handlePrivateChange = useCallback(
    (next: boolean) => {
      setPrivateOverride(next);
      if (!next) return;
      // Going private takes back anyone it was about to be sent to.
      const s = useQuickCaptureStore.getState();
      deselectTargets("friend", s.friendIds);
      deselectTargets("group", s.groupIds);
    },
    [setPrivateOverride, deselectTargets],
  );

  // Picking a habit takes over whoever its check-in already reaches: drop
  // them from the hand-picked lists so the picker shows them locked, and so
  // they come back unpicked — not silently re-selected — when the habit is.
  const handleToggle = useCallback(
    (kind: ShareTarget, id: string) => {
      toggleTarget(kind, id);
      // Picking a person or a group is sharing it, so it is no longer private.
      if (kind !== "habit") {
        setPrivateOverride(false);
        return;
      }
      const reached = reachedByHabits(
        habits,
        useQuickCaptureStore.getState().habitIds,
      );
      deselectTargets("friend", reached.friend.keys());
      deselectTargets("group", reached.group.keys());
    },
    [habits, toggleTarget, deselectTargets, setPrivateOverride],
  );

  const handleSend = useCallback(async () => {
    if (!capturedFile || !captureMode || selectedCount === 0) return;
    // The picked habits' check-ins go to their partners and groups too, and
    // the first time that reaches anybody it waits for a yes. Friends and
    // groups picked by hand are being sent to on purpose, so they never ask.
    if (!(await confirmSharing(habitIds))) return;
    // A second tap made while that was answering waits on the same answer;
    // the first send has left the picker by now, so this one stops here.
    if (useQuickCaptureStore.getState().step !== "share") return;
    void send(
      capturedFile,
      captureMode,
      notes,
      { habitIds, friendIds, groupIds },
      isPrivate,
    );
  }, [
    capturedFile,
    captureMode,
    selectedCount,
    confirmSharing,
    send,
    notes,
    habitIds,
    friendIds,
    groupIds,
    isPrivate,
  ]);

  const handleClose = useCallback(() => {
    close();
    setHabitsUnavailable(null);
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

      {/* Camera - full screen (Snapchat-style: tap for photo, hold for video,
          or a voice note from its Voice mode) */}
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
          useLabel={direct ? `Send to ${direct.name}` : undefined}
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
            <h2 className="font-display text-lg font-medium text-text-primary">
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
                  {captureMode === "voice" ? (
                    <span className="w-full h-full flex items-center justify-center">
                      <Mic className="w-6 h-6 text-text-secondary" aria-hidden />
                    </span>
                  ) : captureMode === "photo" ? (
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
                  "bg-elevated border-border",
                  "text-text-primary placeholder-text-tertiary",
                  "focus:outline-none focus:ring-2 focus:ring-brand-ink",
                )}
              />
            </div>

            <ShareTargetPicker
              habits={habits}
              habitsLoading={habitsLoading}
              habitsUnavailable={habitsUnavailable}
              friends={pickerFriends}
              groups={pickerGroups}
              selected={selected}
              onToggle={handleToggle}
            />
          </div>

          <div className="border-t border-surface-hover bg-bg-primary px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SelectedTargets
              habits={habits}
              friends={pickerFriends}
              groups={pickerGroups}
              selected={selected}
              onToggle={handleToggle}
            />
            {habitIds.length > 0 && (
              <div className="flex justify-end pb-3">
                <PrivateToggle
                  isPrivate={isPrivate}
                  onChange={handlePrivateChange}
                />
              </div>
            )}
            <Button
              className="w-full min-h-12"
              disabled={selectedCount === 0}
              onClick={handleSend}
            >
              <Send className="inline w-4 h-4 mr-2 -mt-0.5" aria-hidden />
              {selectedCount === 0
                ? "Pick where to send it"
                : online
                  ? `Send to ${selectedCount}`
                  : `Send to ${selectedCount} when online`}
            </Button>
          </div>
        </div>
      )}

      {/* Uploading overlay — offline, the take is only being stored */}
      {step === "uploading" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-bg-elevated p-8 shadow-lg">
            <Loader2 className="w-8 h-8 animate-spin text-brand-ink" />
            <p className="text-sm font-medium text-text-primary">
              {online ? "Uploading..." : "Saving..."}
            </p>
          </div>
        </div>
      )}

      {ToastElements}
    </>
  );
}
