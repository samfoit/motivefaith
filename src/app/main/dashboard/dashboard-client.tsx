"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { toDateKey, todayDateKey } from "@/lib/utils/timezone";
import { isHabitScheduledOn, parseTimeWindow } from "@/lib/utils/schedule";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { HabitWithCompletions } from "@/components/habits/HabitCard";
import { useCompleteHabit } from "@/lib/hooks/useCompleteHabit";
import { useToast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";

const DayView = dynamic(
  () => import("./DayView").then((m) => m.DayView),
  { loading: () => <Skeleton variant="rect" className="w-full h-64" /> },
);
const WeekView = dynamic(
  () => import("./WeekView").then((m) => m.WeekView),
  { loading: () => <Skeleton variant="rect" className="w-full h-64" /> },
);
const MonthView = dynamic(
  () => import("./MonthView").then((m) => m.MonthView),
  { loading: () => <Skeleton variant="rect" className="w-full h-64" /> },
);

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

interface DashboardClientProps {
  habits: HabitWithCompletions[];
  timezone: string;
}

type TimeGroup = "morning" | "afternoon" | "evening" | "anytime";

type ViewMode = "day" | "week" | "month";

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
  const { show: showToast, ToastElements } = useToast();
  const [showConfetti, setShowConfetti] = useState(false);
  const [flyout, setFlyout] = useState<{ emoji: string; from: { x: number; y: number } } | null>(null);
  const [completionHabitId, setCompletionHabitId] = useState<string | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("day");

  // Rehydrate viewMode from localStorage after mount. Reading during the
  // useState initializer is unreliable here — SSR returns "day" and the
  // client's hydration render must match the server HTML, so the stored
  // value only takes effect after a re-render anyway. Doing it in an
  // effect keeps hydration clean and guarantees the stored value is read.
  useEffect(() => {
    const stored = localStorage.getItem("motive:dashboard-view");
    if (stored === "day" || stored === "week" || stored === "month") {
      setViewMode(stored);
    }
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("motive:dashboard-view", mode);
  }, []);
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

  const handleQuickComplete = useCallback(
    async (habitId: string, origin?: { x: number; y: number }) => {
      if (completionMap.get(habitId)) return;
      const habit = habits.find((h) => h.id === habitId);
      const prevStreak = habit?.streak_current ?? 0;

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
                    id: `temp-${Date.now()}`,
                    completed_at: new Date().toISOString(),
                    completion_type: "quick" as const,
                  },
                ],
                streak_current: (h.streak_current ?? 0) + 1,
              }
            : h,
        ),
      );

      try {
        await completeHabit.mutateAsync({ habitId, type: "quick" });
        checkMilestone(habit?.title ?? "", prevStreak + 1, habit?.frequency);
        router.refresh();
      } catch {
        setHabits(initialHabits);
      }
    },
    [
      habits,
      completionMap,
      completeHabit,
      checkMilestone,
      router,
      initialHabits,
    ],
  );

  const handleHabitPress = useCallback(
    (habitId: string) => {
      router.push(`/main/habits/${habitId}`);
    },
    [router],
  );

  const handleLongPress = useCallback(
    (habitId: string) => {
      if (completionMap.get(habitId)) return;
      setCompletionHabitId(habitId);
    },
    [completionMap],
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
          onLongPress={handleLongPress}
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
          if (!open) setCompletionHabitId(null);
        }}
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
