"use client";

import { useState, useMemo, useCallback, useEffect, useRef, useTransition } from "react";
import dynamic from "next/dynamic";
import { toDateKey, todayDateKey } from "@/lib/utils/timezone";
import { isHabitScheduledOn, parseTimeWindow } from "@/lib/utils/schedule";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import type { CheckInAction } from "@/lib/constants/check-in";
import { useCompleteHabit } from "@/lib/hooks/useCompleteHabit";
import { useToast } from "@/components/ui/Toast";
import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";
import {
  persistDashboardView,
  type DashboardView,
} from "@/lib/constants/dashboard-view";

/**
 * Last-resort fallback for the lazily-imported views.
 *
 * It should almost never be seen:
 *   - the view the user arrives on is server-rendered (see the view cookie),
 *     so this is not part of a normal page load;
 *   - a user-initiated switch runs inside a transition, so React keeps the
 *     current view on screen while the new chunk loads rather than falling
 *     back at all.
 *
 * That leaves one window: hydration, if the active view's chunk has not
 * arrived by the time React hydrates. Measured at ~257ms on Slow 4G + 4x CPU,
 * which is why this screen uses a 500ms reveal delay rather than the default
 * 200ms — below that it would appear for a few dozen milliseconds and read as
 * a glitch. It replaces a bare `w-full h-64` grey rectangle that shared no
 * visual language with any other skeleton in the app.
 */
function ViewSwitchSkeleton() {
  return (
    <SkeletonScreen
      label="Loading view"
      className="space-y-6 [--skeleton-delay:500ms]"
    >
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton variant="text" width={120} height={16} />
          <Skeleton variant="text" width={32} height={16} />
        </div>
        <Skeleton variant="rect" width="100%" height={8} className="rounded-full" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm border-l-[3px] border-gray-200"
          >
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton variant="circle" width={28} height={28} />
                <Skeleton variant="text" width="60%" height={20} />
              </div>
              <Skeleton variant="text" width="40%" height={14} />
            </div>
            <Skeleton variant="circle" width={40} height={40} />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}

const DayView = dynamic(() => import("./DayView").then((m) => m.DayView), {
  loading: ViewSwitchSkeleton,
});
const WeekView = dynamic(() => import("./WeekView").then((m) => m.WeekView), {
  loading: ViewSwitchSkeleton,
});
const MonthView = dynamic(() => import("./MonthView").then((m) => m.MonthView), {
  loading: ViewSwitchSkeleton,
});

const CompletionForm = dynamic(
  () =>
    import("@/components/habits/CompletionForm").then((m) => m.CompletionForm),
  { ssr: false, loading: () => null },
);
const StreakCelebration = dynamic(
  () =>
    import("@/components/habits/StreakCelebration").then(
      (m) => m.StreakCelebration,
    ),
  { ssr: false, loading: () => null },
);
const CompletionFlyout = dynamic(
  () =>
    import("@/components/habits/CompletionFlyout").then(
      (m) => m.CompletionFlyout,
    ),
  { ssr: false, loading: () => null },
);

// ---------------------------------------------------------------------------
// Streak milestones
// ---------------------------------------------------------------------------

const STREAK_MILESTONES = [7, 14, 21, 30, 50, 100] as const;

const MILESTONE_MESSAGES: Record<number, string> = {
  7: "One week faithful!",
  14: "Two weeks steadfast!",
  21: "21 days — discipline formed!",
  30: "A full month of faithfulness!",
  50: "50-day streak — perseverance!",
  100: "100 days — well done, good and faithful servant!",
};

/**
 * How long a quick check-in stays undoable.
 *
 * The write is held back for this window rather than written and later
 * deleted: reversing a completion server-side would also have to unwind the
 * streak the insert trigger just advanced, and there is no honest way to know
 * what `streak_best` was before it. Nothing is sent until the window closes,
 * so "undo" is simply "never sent" — and the toast that offers it is on screen
 * for exactly as long as the window lasts.
 */
const UNDO_WINDOW_MS = 6000;

type PendingCompletion = {
  timer: ReturnType<typeof setTimeout>;
  toastId: string;
  /** Sends the check-in now, ending its undo window early. */
  commit: () => Promise<void>;
};

interface DashboardClientProps {
  habits: HabitWithCompletions[];
  timezone: string;
  /** Resolved on the server from the view-preference cookie. */
  initialView: DashboardView;
}

type TimeGroup = "morning" | "afternoon" | "evening" | "anytime";

function getTimeGroup(
  timeWindow: { start?: string; end?: string } | null,
): TimeGroup {
  if (!timeWindow?.start) return "anytime";
  const hour = parseInt(timeWindow.start.split(":")[0], 10);
  if (isNaN(hour)) return "anytime";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function isCompletedToday(
  completions: { completed_at: string }[],
  tz: string,
): boolean {
  const today = todayDateKey(tz);
  return completions.some((c) => toDateKey(c.completed_at, tz) === today);
}


export function DashboardClient({
  habits: initialHabits,
  timezone,
  initialView,
}: DashboardClientProps) {
  const router = useRouter();
  const [habits, setHabits] = useState(initialHabits);

  // Sync local state when server data changes (e.g. QuickCaptureFlow
  // completes a habit from the layout and triggers router.refresh()).
  // This is React's recommended pattern for adjusting state when a prop
  // changes — setting state during render avoids the extra render cycle
  // that useEffect would cause.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevInitialHabits, setPrevInitialHabits] = useState(initialHabits);
  if (prevInitialHabits !== initialHabits) {
    setPrevInitialHabits(initialHabits);
    setHabits(initialHabits);
  }

  const completeHabit = useCompleteHabit();
  const { show: showToast, remove: removeToast, ToastElements } = useToast();
  const [showConfetti, setShowConfetti] = useState(false);
  const [flyout, setFlyout] = useState<{ emoji: string; from: { x: number; y: number } } | null>(null);
  const [completionHabitId, setCompletionHabitId] = useState<string | null>(
    null,
  );
  // Which check-in the habit card's drawer asked for, so the sheet can open
  // straight onto the camera, recorder or note instead of the picker.
  const [completionAction, setCompletionAction] =
    useState<Exclude<CheckInAction, "quick"> | null>(null);
  // Seeded from the server, which read the preference cookie — so the view
  // the user actually wants is the one that gets server-rendered, and there is
  // no post-hydration swap into a not-yet-downloaded chunk.
  const [viewMode, setViewMode] = useState<DashboardView>(initialView);

  // Switching views loads a different chunk. Inside a transition React keeps
  // the view that is currently on screen until the new one is ready, instead
  // of tearing it down and showing a placeholder — so a switch never flashes
  // a loading state, however slow the chunk is.
  const [, startViewTransition] = useTransition();

  const handleViewModeChange = useCallback(
    (mode: DashboardView) => {
      persistDashboardView(mode);
      startViewTransition(() => setViewMode(mode));
    },
    [],
  );
  const dismissConfetti = useCallback(() => setShowConfetti(false), []);
  const dismissFlyout = useCallback(() => setFlyout(null), []);

  const checkMilestone = useCallback(
    (habitTitle: string, newStreak: number, frequency?: string | null) => {
      if (!(STREAK_MILESTONES as readonly number[]).includes(newStreak)) return;
      const unit = frequency === "weekly" ? "week" : "day";
      setShowConfetti(true);
      showToast({
        variant: "success",
        title: `${MILESTONE_MESSAGES[newStreak]} 🔥`,
        description: `${habitTitle} — ${newStreak}-${unit} streak`,
      });
    },
    [showToast],
  );

  const completionHabit = completionHabitId
    ? habits.find((h) => h.id === completionHabitId)
    : null;

  const completionMap = useMemo(() => {
    const map = new Map<string, boolean>();
    habits.forEach((h) =>
      map.set(h.id, isCompletedToday(h.completions, timezone)),
    );
    return map;
  }, [habits, timezone]);

  const todayHabits = useMemo(
    () => habits.filter((h) => isHabitScheduledOn(h, new Date(), timezone)),
    [habits, timezone],
  );

  const groupedHabits = useMemo(() => {
    const groups: Record<TimeGroup, HabitWithCompletions[]> = {
      morning: [],
      afternoon: [],
      evening: [],
      anytime: [],
    };
    todayHabits.forEach((habit) => {
      groups[getTimeGroup(parseTimeWindow(habit.time_window))].push(habit);
    });
    return groups;
  }, [todayHabits]);

  const topStreaks = useMemo(
    () =>
      [...habits]
        .filter((h) => (h.streak_current ?? 0) > 0)
        .sort((a, b) => (b.streak_current ?? 0) - (a.streak_current ?? 0))
        .slice(0, 3),
    [habits],
  );

  const completedCount = useMemo(
    () => todayHabits.filter((h) => completionMap.get(h.id)).length,
    [todayHabits, completionMap],
  );

  const handleCompletion = async ({
    type,
    evidenceUrl,
    notes,
  }: {
    type: "photo" | "video" | "message" | "quick" | "voice";
    evidenceUrl?: string;
    notes?: string;
  }) => {
    if (!completionHabitId) return;
    const habitId = completionHabitId;
    const habit = habits.find((h) => h.id === habitId);
    const prevStreak = habit?.streak_current ?? 0;

    // Optimistic update
    setHabits((prev) =>
      prev.map((h) =>
        h.id === habitId
          ? {
              ...h,
              completions: [
                ...h.completions,
                {
                  id: `temp-${Date.now()}`,
                  completed_at: new Date().toISOString(),
                  completion_type: type,
                },
              ],
              streak_current: (h.streak_current ?? 0) + 1,
            }
          : h,
      ),
    );

    try {
      await completeHabit.mutateAsync({ habitId, type, evidenceUrl, notes });
      checkMilestone(habit?.title ?? "", prevStreak + 1, habit?.frequency);
      router.refresh();
    } catch {
      setHabits(initialHabits);
    }
  };

  // Quick check-ins waiting out their undo window, keyed by habit. Each entry
  // carries its own commit closure, captured when the check-in was made, so
  // the timer and the page-hide flush can send it without re-subscribing every
  // time `habits` changes.
  const pendingRef = useRef(new Map<string, PendingCompletion>());

  const settle = useCallback((habitId: string): PendingCompletion | null => {
    const pending = pendingRef.current.get(habitId);
    if (!pending) return null;
    clearTimeout(pending.timer);
    pendingRef.current.delete(habitId);
    return pending;
  }, []);

  const handleQuickComplete = useCallback(
    (habitId: string, origin?: { x: number; y: number }) => {
      if (completionMap.get(habitId)) return;
      const habit = habits.find((h) => h.id === habitId);
      const prevStreak = habit?.streak_current ?? 0;
      const tempId = `temp-${Date.now()}`;

      // Fly the emoji to the feed icon to show it's being shared
      if (origin) {
        setFlyout({ emoji: habit?.emoji ?? "✓", from: origin });
      }

      // Optimistic update
      setHabits((prev) =>
        prev.map((h) =>
          h.id === habitId
            ? {
                ...h,
                completions: [
                  ...h.completions,
                  {
                    id: tempId,
                    completed_at: new Date().toISOString(),
                    completion_type: "quick" as const,
                  },
                ],
                streak_current: (h.streak_current ?? 0) + 1,
              }
            : h,
        ),
      );

      const undo = () => {
        const pending = settle(habitId);
        if (!pending) return; // Window already closed — the check-in is sent.
        removeToast(pending.toastId);
        setHabits((prev) =>
          prev.map((h) =>
            h.id === habitId
              ? {
                  ...h,
                  completions: h.completions.filter((c) => c.id !== tempId),
                  streak_current: prevStreak,
                }
              : h,
          ),
        );
      };

      const commit = async () => {
        const pending = settle(habitId);
        if (!pending) return;
        // Take the toast down with the window, so an "Undo" that would no
        // longer undo anything is never left on screen.
        removeToast(pending.toastId);
        try {
          await completeHabit.mutateAsync({ habitId, type: "quick" });
          checkMilestone(habit?.title ?? "", prevStreak + 1, habit?.frequency);
          router.refresh();
        } catch {
          setHabits(initialHabits);
          showToast({
            variant: "error",
            title: "Check-in failed",
            description: habit?.title,
          });
        }
      };

      const toastId = showToast({
        variant: "success",
        title: `${habit?.emoji ?? "✓"} Checked in`,
        description: habit?.title,
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          altText: `Undo the check-in for ${habit?.title ?? "this habit"}`,
          onClick: undo,
        },
      });

      pendingRef.current.set(habitId, {
        toastId,
        commit,
        timer: setTimeout(commit, UNDO_WINDOW_MS),
      });
    },
    [
      habits,
      completionMap,
      completeHabit,
      checkMilestone,
      router,
      initialHabits,
      showToast,
      removeToast,
      settle,
    ],
  );

  useEffect(() => {
    const pending = pendingRef.current;
    const flush = () => {
      for (const entry of [...pending.values()]) void entry.commit();
    };
    // Leaving the page — or backgrounding it on mobile — ends the undo window:
    // send what is held rather than dropping it.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, []);

  const handleHabitPress = useCallback(
    (habitId: string) => {
      router.push(`/main/habits/${habitId}`);
    },
    [router],
  );

  const handleCheckIn = useCallback(
    (
      habitId: string,
      action: CheckInAction,
      origin?: { x: number; y: number },
    ) => {
      if (completionMap.get(habitId)) return;
      // A quick check-in needs nothing else from the user — log it in place.
      if (action === "quick") {
        handleQuickComplete(habitId, origin);
        return;
      }
      setCompletionAction(action);
      setCompletionHabitId(habitId);
    },
    [completionMap, handleQuickComplete],
  );

  const handleCreateHabit = useCallback(() => {
    router.push("/main/habits/new");
  }, [router]);

  return (
    <>
      {/* View Toggle */}
      {habits.length > 0 && (
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary)]">
          {(["day", "week", "month"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleViewModeChange(mode)}
              className={cn(
                "flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize",
                viewMode === mode
                  ? "bg-brand text-white"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      )}

      {/* Views */}
      {viewMode === "day" && (
        <DayView
          todayHabits={todayHabits}
          groupedHabits={groupedHabits}
          topStreaks={topStreaks}
          completionMap={completionMap}
          completedCount={completedCount}
          hasHabits={habits.length > 0}
          onQuickComplete={handleQuickComplete}
          onHabitPress={handleHabitPress}
          onCheckIn={handleCheckIn}
          onCreateHabit={handleCreateHabit}
        />
      )}

      {viewMode === "week" && habits.length > 0 && (
        <WeekView
          habits={habits}
          timezone={timezone}
          onHabitPress={handleHabitPress}
        />
      )}

      {viewMode === "month" && habits.length > 0 && (
        <MonthView
          habits={habits}
          timezone={timezone}
          onHabitPress={handleHabitPress}
        />
      )}

      {/* Completion Sheet */}
      <CompletionForm
        open={!!completionHabit}
        onOpenChange={(open) => {
          if (!open) {
            setCompletionHabitId(null);
            setCompletionAction(null);
          }
        }}
        initialAction={completionAction}
        habitId={completionHabit?.id ?? ""}
        habitTitle={completionHabit?.title ?? ""}
        habitEmoji={completionHabit?.emoji ?? ""}
        onComplete={handleCompletion}
      />

      {/* Streak milestone celebration */}
      <StreakCelebration active={showConfetti} onDone={dismissConfetti} />
      <CompletionFlyout active={!!flyout} emoji={flyout?.emoji ?? ""} from={flyout?.from} onDone={dismissFlyout} />
      {ToastElements}
    </>
  );
}
