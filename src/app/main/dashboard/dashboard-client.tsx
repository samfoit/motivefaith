"use client";

import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useTransition,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import { toDateKey, todayDateKey, weekdayName } from "@/lib/utils/timezone";
import {
  isHabitScheduledOn,
  makeupOriginOn,
  parseTimeWindow,
} from "@/lib/utils/schedule";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import type { MoveLabels } from "@/lib/types/habit";
import type { CheckInAction } from "@/lib/constants/check-in";
import { isRainCheck, type CompletionType } from "@/lib/constants/completion";
import type { RainCheckReason } from "@/lib/constants/rain-check";
import { useCompleteHabit } from "@/lib/hooks/useCompleteHabit";
import { useToast } from "@/components/ui/Toast";
import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";
import { DashboardContentSkeleton } from "./DashboardSkeleton";
import { OfflinePanel } from "@/components/pwa/OfflinePanel";
import {
  persistDashboardView,
  readDashboardView,
  type DashboardView,
} from "@/lib/constants/dashboard-view";
import { useDashboard, dashboardKey } from "@/lib/hooks/useDashboard";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import type { DashboardData } from "@/lib/data/dashboard";
import { applyCompletion, removeCompletion } from "@/lib/data/dashboard-mutations";
import { getBrowserTimezone, DEFAULT_TIMEZONE } from "@/lib/utils/timezone";

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
 * a glitch. It replaces a bare `w-full h-64` gray rectangle that shared no
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
            className="flex items-center gap-3 rounded-lg bg-[var(--color-bg-elevated)] p-4 shadow-sm border border-[var(--color-bg-secondary)]"
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

/**
 * True only after hydration.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` flag: it needs
 * no subscription, no state update, and no extra render pass, and it is the
 * hydration-safe way to render something the server cannot know.
 */
const noopSubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function getGreeting(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(new Date());
  const parsed = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10);
  const hour = Number.isNaN(parsed) ? 12 : parsed;
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date());
}

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
  /**
   * Rendered beside the greeting. Passed down from the page so the link stays
   * in the Server Component — it is the same markup for every user, which is
   * the point of the shell.
   */
  headerAction?: React.ReactNode;
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
  completions: { completed_at: string; completion_type?: string | null }[],
  tz: string,
): boolean {
  const today = todayDateKey(tz);
  return completions.some(
    (c) =>
      !isRainCheck(c.completion_type) && toDateKey(c.completed_at, tz) === today,
  );
}

/**
 * A rain check settles the day without closing the habit: it is shown
 * differently, and the user can still change their mind and check in.
 */
function isRainCheckedToday(
  completions: { completed_at: string; completion_type?: string | null }[],
  tz: string,
): boolean {
  const today = todayDateKey(tz);
  return completions.some(
    (c) =>
      isRainCheck(c.completion_type) && toDateKey(c.completed_at, tz) === today,
  );
}


/**
 * The day today's rain check promised to make the habit up on, as a weekday
 * name — or null when today's rain check was a plain skip, or there isn't one.
 */
function rainCheckMovedToToday(
  completions: {
    completed_at: string;
    completion_type?: string | null;
    rain_check_moved_to?: string | null;
  }[],
  tz: string,
): string | null {
  const today = todayDateKey(tz);
  for (const c of completions) {
    if (!isRainCheck(c.completion_type)) continue;
    if (toDateKey(c.completed_at, tz) !== today) continue;
    if (c.rain_check_moved_to) return weekdayName(c.rain_check_moved_to);
  }
  return null;
}

export function DashboardClient({ headerAction }: DashboardClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthUserId();
  const { data, isPending, isError, refetch } = useDashboard();
  const queryKey = dashboardKey(userId);

  // The cache is the single source of truth, including for optimistic
  // updates. Keeping optimism in component state instead — as this did — meant
  // a completion logged offline disappeared from the UI on reload while still
  // sitting unsent in the outbox, because only the cache is persisted.
  const habits = useMemo(() => data?.habits ?? [], [data]);
  const firstName = data?.firstName ?? null;
  const isClient = useIsClient();
  /** Render the real views only once there is something real to render. */
  const showData = !isPending && !(isError && !data);

  /** Roll the cache back to a captured snapshot after a failed write. */
  const restore = useCallback(
    (snapshot: DashboardData | undefined) => {
      if (snapshot) queryClient.setQueryData(queryKey, snapshot);
    },
    [queryClient, queryKey],
  );

  /**
   * Refetch after a write, unless it was queued offline: the optimistic entry
   * is then the only record the UI has until the outbox drains, and a refetch
   * would either fail or overwrite it with server data that does not have it
   * yet.
   */
  const settleWrite = useCallback(
    (result: unknown) => {
      if (result && typeof result === "object" && "queued" in result) return;
      if (navigator.onLine) void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient, queryKey],
  );

  // The payload carries the user's stored timezone; before it arrives, fall
  // back to the browser's, so dates are right from the first paint.
  const timezone = data?.timezone || getBrowserTimezone() || DEFAULT_TIMEZONE;

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
  // Read synchronously in the initializer, so the user's actual view is
  // chosen in the very first client render. Restoring it in an effect instead
  // is what produced DIAGNOSIS R5: a second render mounted a lazily-imported
  // view whose chunk had not downloaded, flashing a gray placeholder ~2s after
  // the page looked finished.
  const [viewMode, setViewMode] = useState<DashboardView>(readDashboardView);

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

  const rainCheckMap = useMemo(() => {
    const map = new Map<string, boolean>();
    habits.forEach((h) =>
      map.set(h.id, isRainCheckedToday(h.completions, timezone)),
    );
    return map;
  }, [habits, timezone]);

  /**
   * Habits sitting on today only because an earlier rain check was moved onto
   * it, keyed to the weekday they moved from. This is the one way a habit
   * appears off its own schedule.
   */
  const makeupMap = useMemo(() => {
    const today = todayDateKey(timezone);
    const map = new Map<string, string>();
    habits.forEach((h) => {
      const from = makeupOriginOn(h.completions, today, timezone);
      if (from) map.set(h.id, weekdayName(from));
    });
    return map;
  }, [habits, timezone]);

  const moveMap = useMemo(() => {
    const map = new Map<string, MoveLabels>();
    habits.forEach((h) => {
      const movedTo = rainCheckMovedToToday(h.completions, timezone);
      const movedFrom = makeupMap.get(h.id) ?? null;
      if (movedTo || movedFrom) map.set(h.id, { movedTo, movedFrom });
    });
    return map;
  }, [habits, timezone, makeupMap]);

  const todayHabits = useMemo(
    () =>
      habits.filter(
        (h) =>
          isHabitScheduledOn(h, new Date(), timezone) || makeupMap.has(h.id),
      ),
    [habits, timezone, makeupMap],
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
    rainCheckReason,
    rainCheckMovedTo,
  }: {
    type: CompletionType;
    evidenceUrl?: string;
    notes?: string;
    rainCheckReason?: RainCheckReason;
    rainCheckMovedTo?: string;
  }) => {
    if (!completionHabitId) return;
    const habitId = completionHabitId;
    const habit = habits.find((h) => h.id === habitId);
    const prevStreak = habit?.streak_current ?? 0;
    // A rain check holds the streak where it is — it never advances it, and
    // it can never cross a milestone.
    const rainCheck = isRainCheck(type);

    // Optimistic update, written to the cache so it is persisted and survives
    // a reload while the write is still queued offline.
    const snapshot = queryClient.getQueryData<DashboardData>(queryKey);
    queryClient.setQueryData<DashboardData>(queryKey, (old) =>
      applyCompletion(old, {
        habitId,
        tempId: `temp-${Date.now()}`,
        type,
        rainCheckMovedTo,
      }),
    );

    try {
      const result = await completeHabit.mutateAsync({
        habitId,
        type,
        evidenceUrl,
        notes,
        rainCheckReason,
        rainCheckMovedTo,
      });
      if (!rainCheck) {
        checkMilestone(habit?.title ?? "", prevStreak + 1, habit?.frequency);
      }
      settleWrite(result);
    } catch {
      restore(snapshot);
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

      // Optimistic update, in the cache rather than component state — see the
      // note on `habits` above.
      const snapshot = queryClient.getQueryData<DashboardData>(queryKey);
      queryClient.setQueryData<DashboardData>(queryKey, (old) =>
        applyCompletion(old, { habitId, tempId, type: "quick" }),
      );

      const undo = () => {
        const pending = settle(habitId);
        if (!pending) return; // Window already closed — the check-in is sent.
        removeToast(pending.toastId);
        queryClient.setQueryData<DashboardData>(queryKey, (old) =>
          removeCompletion(old, { habitId, tempId, streak: prevStreak }),
        );
      };

      const commit = async () => {
        const pending = settle(habitId);
        if (!pending) return;
        // Take the toast down with the window, so an "Undo" that would no
        // longer undo anything is never left on screen.
        removeToast(pending.toastId);
        try {
          const result = await completeHabit.mutateAsync({ habitId, type: "quick" });
          checkMilestone(habit?.title ?? "", prevStreak + 1, habit?.frequency);
          settleWrite(result);
        } catch {
          restore(snapshot);
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
      queryClient,
      queryKey,
      restore,
      settleWrite,
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
      if (action === "rain_check") {
        // Already skipped today — no point stacking a second rain check on it.
        if (rainCheckMap.get(habitId)) return;
        // A makeup cannot itself be rain-checked: the habit is only on today
        // because an earlier skip promised it, and moving a promise again
        // would let it be deferred forever. The habit's own scheduled days
        // still offer it.
        const habit = habits.find((h) => h.id === habitId);
        if (habit && !isHabitScheduledOn(habit, new Date(), timezone)) return;
      }
      // A quick check-in needs nothing else from the user — log it in place.
      if (action === "quick") {
        handleQuickComplete(habitId, origin);
        return;
      }
      setCompletionAction(action);
      setCompletionHabitId(habitId);
    },
    [completionMap, rainCheckMap, habits, timezone, handleQuickComplete],
  );

  const handleCreateHabit = useCallback(() => {
    router.push("/main/habits/new");
  }, [router]);

  return (
    <>
      {/*
        Greeting — rendered on the client only, and deliberately so.

        This document is cached by the service worker and replayed to whoever
        opens the app next, including tomorrow and including offline. A
        time-of-day greeting or the user's name baked in at request time would
        be both stale and a data leak. The height is reserved so filling it in
        after hydration shifts nothing below it (the dashboard's CLS is
        0.0000 and must stay there), and the h1 is single-line so a long
        display name cannot reflow the header either.
      */}
      <div className="flex items-center justify-between min-h-[3.25rem]">
        <div className="min-w-0">
          {isClient && (
            <>
              <h1
                className="font-display font-bold text-text-primary truncate"
                style={{ fontSize: "var(--text-2xl)" }}
              >
                {getGreeting(timezone)}
                {firstName ? `, ${firstName}` : ""}
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                {formatToday(timezone)}
              </p>
            </>
          )}
        </div>
        {headerAction}
      </div>

      {isPending && <DashboardContentSkeleton />}

      {/*
        No data and no cached copy to fall back on. Without this the views
        below would render their "create your first habit" empty state, which
        tells the user their habits are gone rather than that the app could
        not reach them.
      */}
      {isError && !data && (
        <OfflinePanel what="Your habits" onRetry={() => void refetch()} />
      )}

      {/* View Toggle */}
      {showData && habits.length > 0 && (
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
      {showData && viewMode === "day" && (
        <DayView
          todayHabits={todayHabits}
          groupedHabits={groupedHabits}
          topStreaks={topStreaks}
          completionMap={completionMap}
          rainCheckMap={rainCheckMap}
          moveMap={moveMap}
          completedCount={completedCount}
          hasHabits={habits.length > 0}
          onQuickComplete={handleQuickComplete}
          onHabitPress={handleHabitPress}
          onCheckIn={handleCheckIn}
          onCreateHabit={handleCreateHabit}
        />
      )}

      {showData && viewMode === "week" && habits.length > 0 && (
        <WeekView
          habits={habits}
          timezone={timezone}
          onHabitPress={handleHabitPress}
        />
      )}

      {showData && viewMode === "month" && habits.length > 0 && (
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
        habitSchedule={completionHabit?.schedule}
        timezone={timezone}
        onComplete={handleCompletion}
      />

      {/* Streak milestone celebration */}
      <StreakCelebration active={showConfetti} onDone={dismissConfetti} />
      <CompletionFlyout active={!!flyout} emoji={flyout?.emoji ?? ""} from={flyout?.from} onDone={dismissFlyout} />
      {ToastElements}
    </>
  );
}
