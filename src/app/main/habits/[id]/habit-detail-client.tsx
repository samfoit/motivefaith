"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Camera,
  CloudRain,
  Video,
  MessageSquare,
  Zap,
  Flame,
  Trophy,
  Target,
  TrendingUp,
  Pause,
  Play,
  Trash2,
  UserPlus,
  Users,
  X,
  Pencil,
  Share2,
  Mic,
  Lock,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useRouter } from "next/navigation";
import { TopBarActions, TopBarTitle } from "@/components/layout/TopBarSlots";
import {
  TOP_BAR_ICON_BUTTON_CLASS,
  TOP_BAR_TITLE_CLASS,
  TOP_BAR_TITLE_STYLE,
} from "@/components/layout/topBarStyles";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { toDateKey, todayDateKey, weekdayName } from "@/lib/utils/timezone";
import {
  describeDays,
  formatWindow,
  getScheduledDays,
  parseTimeWindow,
  timeWindowGroups,
  type DayWindow,
} from "@/lib/utils/schedule";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EvidenceMedia } from "@/components/ui/EvidenceMedia";
import { EvidenceAudio } from "@/components/ui/EvidenceAudio";
import { MediaLightbox } from "@/components/ui/MediaLightbox";
import { useNearViewport } from "@/lib/hooks/useNearViewport";
import { HISTORY_PAGE_SIZE } from "@/lib/constants/limits";
import { FriendPicker } from "@/components/social/FriendPicker";
import { CalendarHeatmap } from "@/components/habits/CalendarHeatmap";
import { useCompleteHabit, PrivateOfflineError } from "@/lib/hooks/useCompleteHabit";
import { useConfirmSharing } from "@/lib/hooks/useConfirmSharing";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import type { Tables } from "@/lib/supabase/types";
import type { Habit } from "@/lib/types/habit";
import type { DashboardData } from "@/lib/data/dashboard";
import { applyHabitUpdate, removeHabit } from "@/lib/data/dashboard-mutations";
import { mergePrivateContent } from "@/lib/utils/private-checkin";
import { DASHBOARD_KEY_PREFIX } from "@/lib/hooks/useDashboard";
import { isRainCheck, type CompletionType } from "@/lib/constants/completion";
import { countsTowardStreak } from "@/lib/utils/streak";
import {
  rainCheckReasonLabel,
  type RainCheckReason,
} from "@/lib/constants/rain-check";

const CompletionForm = dynamic(
  () => import("@/components/habits/CompletionForm").then((m) => m.CompletionForm),
  { ssr: false },
);
const StreakCelebration = dynamic(
  () => import("@/components/habits/StreakCelebration").then((m) => m.StreakCelebration),
  { ssr: false },
);
const EditHabitSheet = dynamic(
  () => import("@/components/habits/EditHabitSheet").then((m) => m.EditHabitSheet),
  { ssr: false },
);
const ShareCardSheet = dynamic(
  () => import("@/components/social/ShareCardSheet").then((m) => m.ShareCardSheet),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------



type Completion = {
  id: string;
  habit_id: string;
  completion_type: Tables<"completions">["completion_type"];
  evidence_url: string | null;
  notes: string | null;
  completed_at: string;
  rain_check_reason?: Tables<"completions">["rain_check_reason"];
  rain_check_moved_to?: Tables<"completions">["rain_check_moved_to"];
  /** Recorded for the owner only; partners saw a plain check-in. */
  is_private?: boolean;
};

/**
 * A completion as the heatmap, streak and "done today" see it: just when, and
 * what kind. Covers the recent window in full, independent of how far back
 * the History tab has been paged.
 */
type ActivityRow = Pick<
  Completion,
  "id" | "completion_type" | "completed_at" | "rain_check_moved_to"
>;

// Ends with PRIVATE_CONTENT_EMBED, spelled out so postgrest-js can infer it.
const COMPLETION_COLUMNS =
  "id, habit_id, completion_type, evidence_url, notes, completed_at, rain_check_reason, rain_check_moved_to, completion_private_content(completion_type, evidence_url, notes)";

type Partner = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username: string;
};

/**
 * One live partnership. `direction` says who started it, which is what decides
 * whose move it is while `status` is still pending: an invitation is waiting on
 * them, a request is waiting on you.
 */
type PartnerRow = {
  shareId: string;
  status: "accepted" | "pending";
  direction: "invite" | "request";
  profile: Partner;
};

type SharedGroup = {
  id: string;
  name: string;
  avatar_url: string | null;
  shareId: string;
};

interface HabitDetailClientProps {
  habit: Habit;
  /** The first page of the History tab, newest first. */
  completions: Completion[];
  /** Every completion in the heatmap's window, dates only. */
  activity: ActivityRow[];
  /**
   * Days the habit has been done on, ever. Not total_completions: a habit can
   * be done more than once a day, and the rate counts days.
   */
  daysDone: number;
  partnerRows: PartnerRow[];
  availableFriends?: Partner[];
  sharedGroups?: SharedGroup[];
  timezone: string;
  /** The owner's own username, for the invite link on a shared card. */
  username: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPLETION_ICONS: Record<string, React.ElementType> = {
  quick: Zap,
  photo: Camera,
  video: Video,
  message: MessageSquare,
  voice: Mic,
  rain_check: CloudRain,
};

const COMPLETION_LABELS: Record<string, string> = {
  quick: "Quick check-in",
  photo: "Photo proof",
  video: "Video proof",
  message: "Reflection",
  voice: "Voice message",
  rain_check: "Rain check",
};

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  weeksdays: "Weekdays",
  weekends: "Weekends",
  specific_days: "Custom days",
  weekly: "Weekly",
};

const STREAK_MILESTONES = [7, 14, 21, 30, 50, 100] as const;
const MILESTONE_MESSAGES: Record<number, string> = {
  7: "One week strong!",
  14: "Two weeks locked in!",
  21: "21 days — habit formed!",
  30: "A full month!",
  50: "50-day streak!",
  100: "100 days — legendary!",
};

// Four tabs at their natural width ran past the right edge of a 360px phone
// and took the whole page into horizontal scroll with them. Equal shares of
// the row instead, the way the dashboard's view switcher divides its own.
const TAB_TRIGGER_CLASS = cn(
  "flex-1 min-w-0 truncate px-2 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors",
  "text-[var(--color-text-secondary)]",
  "data-[state=active]:bg-brand data-[state=active]:text-on-brand",
  "hover:text-[var(--color-text-primary)]",
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HabitDetailClient({
  habit: initialHabit,
  completions: initialCompletions,
  activity: initialActivity,
  daysDone: initialDaysDone,
  partnerRows,
  availableFriends = [],
  sharedGroups = [],
  timezone,
  username,
}: HabitDetailClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const completeHabit = useCompleteHabit();
  const confirmSharing = useConfirmSharing();
  const { show: showToast, ToastElements } = useToast();
  const [habit, setHabit] = useState(initialHabit);
  const [completions, setCompletions] = useState(initialCompletions);
  const [activity, setActivity] = useState(initialActivity);
  const [daysDone, setDaysDone] = useState(initialDaysDone);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialCompletions.length >= HISTORY_PAGE_SIZE);
  /** A page failed: stop loading on scroll until the button is pressed. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [addingFriendId, setAddingFriendId] = useState<string | null>(null);
  const [removingShareId, setRemovingShareId] = useState<string | null>(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Photo evidence from this habit, newest first, offered inside the share
  // sheet. Only `photo` completions qualify: a video's evidence would need a
  // frame pulled out of it before anything could draw it.
  const evidencePaths = useMemo(
    () =>
      completions
        .filter((c) => c.completion_type === "photo" && c.evidence_url)
        .slice(0, 6)
        .map((c) => c.evidence_url as string),
    [completions],
  );

  const { partners, invited, requests } = useMemo(() => {
    return {
      partners: partnerRows.filter((r) => r.status === "accepted"),
      invited: partnerRows.filter(
        (r) => r.status === "pending" && r.direction === "invite",
      ),
      requests: partnerRows.filter(
        (r) => r.status === "pending" && r.direction === "request",
      ),
    };
  }, [partnerRows]);

  const dismissConfetti = useCallback(() => setShowConfetti(false), []);

  // Pages are keyed on (completed_at, id), not completed_at alone: an offline
  // batch is written in one transaction, so its rows share a timestamp, and a
  // page boundary falling among them would otherwise skip the rest.
  const loadMoreCompletions = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const oldest = completions.findLast((c) => !c.id.startsWith("temp-"));
    if (!oldest) return;
    setLoadingMore(true);
    setLoadFailed(false);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("completions")
      .select(COMPLETION_COLUMNS)
      .eq("habit_id", habit.id)
      .or(
        `completed_at.lt."${oldest.completed_at}",and(completed_at.eq."${oldest.completed_at}",id.lt.${oldest.id})`,
      )
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE);
    if (error) {
      console.error("Failed to load history:", error.message);
      setLoadFailed(true);
      setLoadingMore(false);
      return;
    }
    const more = (data ?? [])
      .filter(
        (c): c is typeof c & { completed_at: string } => c.completed_at != null,
      )
      .map(mergePrivateContent);
    setCompletions((prev) => [...prev, ...more]);
    setHasMore(more.length >= HISTORY_PAGE_SIZE);
    setLoadingMore(false);
  }, [completions, habit.id, hasMore, loadingMore]);

  // The next page loads as the end of the list nears, so years of history
  // scroll through without a tap per fifty entries. The button stays for
  // when that cannot run, or a page failed.
  //
  // A callback ref, because the History tab's content mounts only while the
  // tab is open. Observing again after each page (completions.length) is what
  // keeps going when a page was too short to push the end off screen: a fresh
  // observer always reports where the element is now.
  const [historyEnd, setHistoryEnd] = useState<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMoreCompletions);
  useEffect(() => {
    loadMoreRef.current = loadMoreCompletions;
  }, [loadMoreCompletions]);
  useEffect(() => {
    if (!historyEnd || !hasMore || loadFailed) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMoreRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(historyEnd);
    return () => observer.disconnect();
  }, [historyEnd, hasMore, loadFailed, completions.length]);

  // --- Derived data ---

  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    activity.forEach((c) => {
      if (isRainCheck(c.completion_type)) return;
      const key = toDateKey(c.completed_at, timezone);
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [activity, timezone]);

  // Days held by a rain check rather than done — drawn apart in the chain.
  //
  // Only rain checks that still hold count. A rain check that was moved to a
  // day which then passed undone stopped excusing anything: it leaves a gap in
  // the heatmap and returns to the completion-rate denominator, because that
  // is what actually happened to the streak.
  const rainCheckDates = useMemo(() => {
    const today = todayDateKey(timezone);
    const realDates = new Set(
      activity
        .filter((c) => !isRainCheck(c.completion_type))
        .map((c) => toDateKey(c.completed_at, timezone)),
    );
    const set = new Set<string>();
    activity.forEach((c) => {
      if (!isRainCheck(c.completion_type)) return;
      const movedTo = c.rain_check_moved_to ?? null;
      const holds =
        movedTo === null || movedTo >= today || realDates.has(movedTo);
      if (holds) set.add(toDateKey(c.completed_at, timezone));
    });
    return set;
  }, [activity, timezone]);

  // The day today's rain check promised to make this habit up on, if any.
  const rainCheckMovedToToday = useMemo(() => {
    const today = todayDateKey(timezone);
    for (const c of activity) {
      if (!isRainCheck(c.completion_type)) continue;
      if (toDateKey(c.completed_at, timezone) !== today) continue;
      if (c.rain_check_moved_to) return c.rain_check_moved_to;
    }
    return null;
  }, [activity, timezone]);

  // Real check-ins today. The first completes the habit for the day; doing
  // it again is logged too, it just doesn't add to the streak.
  const checkInsToday = useMemo(() => {
    const today = todayDateKey(timezone);
    return activity.filter(
      (c) =>
        !isRainCheck(c.completion_type) &&
        toDateKey(c.completed_at, timezone) === today,
    ).length;
  }, [activity, timezone]);
  const completedToday = checkInsToday > 0;

  const rainCheckedToday = useMemo(
    () => rainCheckDates.has(todayDateKey(timezone)),
    [rainCheckDates, timezone],
  );

  const [mountTime] = useState(() => Date.now());
  const completionRate = useMemo(() => {
    // Days done, not check-ins: a habit done three times today was still
    // only done on one day.
    if (daysDone === 0) return 0;
    const createdMs = habit.created_at
      ? new Date(habit.created_at).getTime()
      : mountTime;
    const daysSinceCreation = Math.max(
      1,
      Math.ceil((mountTime - createdMs) / (1000 * 60 * 60 * 24)),
    );
    // Rain-checked days were excused, not failed, so they leave the
    // denominator entirely rather than counting against the rate.
    const eligibleDays = Math.max(1, daysSinceCreation - rainCheckDates.size);
    return Math.min(100, Math.round((daysDone / eligibleDays) * 100));
  }, [daysDone, habit.created_at, mountTime, rainCheckDates]);

  // --- Handlers ---

  const streakUnit = habit.frequency === "weekly" ? "week" : "day";

  const checkMilestone = useCallback(
    (newStreak: number) => {
      if (!(STREAK_MILESTONES as readonly number[]).includes(newStreak)) return;
      setShowConfetti(true);
      showToast({
        variant: "success",
        title: `${MILESTONE_MESSAGES[newStreak]} 🔥`,
        description: `${habit.title} — ${newStreak}-${streakUnit} streak`,
        duration: 8000,
        action: {
          label: "Share",
          altText: `Share your ${newStreak}-${streakUnit} streak`,
          onClick: () => setShareOpen(true),
        },
      });
    },
    [showToast, habit.title, streakUnit],
  );

  const handleCompletion = async ({
    type,
    evidenceUrl,
    notes,
    rainCheckReason,
    rainCheckMovedTo,
    isPrivate,
  }: {
    type: CompletionType;
    evidenceUrl?: string;
    notes?: string;
    rainCheckReason?: RainCheckReason;
    rainCheckMovedTo?: string;
    isPrivate?: boolean;
  }) => {
    const prevStreak = habit.streak_current ?? 0;
    // A rain check holds the streak and is never counted as a completion.
    const rainCheck = isRainCheck(type);
    // Only the day's first real check-in advances the streak, so only it can
    // cross a milestone. Doing the habit again still adds to the total.
    const counts = !rainCheck && countsTowardStreak(habit, activity, timezone);

    // Optimistic update
    const tempCompletion: Completion = {
      id: `temp-${Date.now()}`,
      habit_id: habit.id,
      completion_type: type,
      evidence_url: evidenceUrl ?? null,
      notes: notes ?? null,
      completed_at: new Date().toISOString(),
      rain_check_reason: rainCheckReason ?? null,
      rain_check_moved_to: rainCheckMovedTo ?? null,
      is_private: isPrivate ?? false,
    };
    setCompletions((prev) => [tempCompletion, ...prev]);
    setActivity((prev) => [tempCompletion, ...prev]);
    if (!rainCheck) {
      setHabit((h) => ({
        ...h,
        streak_current: (h.streak_current ?? 0) + (counts ? 1 : 0),
        total_completions: (h.total_completions ?? 0) + 1,
      }));
      if (!completedToday) setDaysDone((n) => n + 1);
    }

    try {
      await completeHabit.mutateAsync({
        habitId: habit.id,
        type,
        evidenceUrl,
        notes,
        rainCheckReason,
        rainCheckMovedTo,
        isPrivate,
      });
      if (counts) checkMilestone(prevStreak + 1);
      router.refresh();
    } catch (err) {
      // Take back only this entry: resetting to the first page would also
      // throw away every page already scrolled through.
      setCompletions((prev) => prev.filter((c) => c.id !== tempCompletion.id));
      setActivity((prev) => prev.filter((c) => c.id !== tempCompletion.id));
      setHabit(initialHabit);
      setDaysDone(initialDaysDone);
      showToast({
        variant: "error",
        title:
          err instanceof PrivateOfflineError
            ? "You're offline — private check-ins need a connection"
            : rainCheck
              ? "Failed to take rain check"
              : "Failed to log completion",
      });
    }
  };

  const handlePauseToggle = async () => {
    setIsPausing(true);
    const supabase = createClient();
    const newPaused = !habit.is_paused;
    const { error } = await supabase
      .from("habits")
      .update({ is_paused: newPaused })
      .eq("id", habit.id);

    if (error) {
      showToast({ variant: "error", title: "Failed to update habit" });
    } else {
      setHabit((h) => ({ ...h, is_paused: newPaused }));
      // Paused habits are left off the dashboard; a resumed one has to be
      // fetched back, since the cache no longer holds it.
      if (newPaused) {
        queryClient.setQueriesData<DashboardData>(
          { queryKey: DASHBOARD_KEY_PREFIX },
          (old) => removeHabit(old, habit.id),
        );
      }
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
      showToast({
        variant: "info",
        title: newPaused ? "Habit paused" : "Habit resumed",
      });
      router.refresh();
    }
    setIsPausing(false);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("habits")
      .delete()
      .eq("id", habit.id);

    if (error) {
      showToast({ variant: "error", title: "Failed to delete habit" });
      setIsDeleting(false);
    } else {
      queryClient.setQueriesData<DashboardData>(
        { queryKey: DASHBOARD_KEY_PREFIX },
        (old) => removeHabit(old, habit.id),
      );
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
      router.replace("/main/dashboard");
      router.refresh();
    }
  };

  const handleAddFriend = async (friendId: string) => {
    setAddingFriendId(friendId);
    const supabase = createClient();
    // An invitation, not a share: the row lands as pending and grants nothing
    // until they accept. Writing habit_shares directly is no longer permitted —
    // the RPC owns the state machine.
    const { error } = await untypedRpc(supabase, "invite_habit_partner", {
      p_habit_id: habit.id,
      p_user_id: friendId,
    });

    if (error) {
      showToast({ variant: "error", title: "Failed to send invite" });
    } else {
      showToast({ variant: "success", title: "Invite sent" });
      router.refresh();
    }
    setAddingFriendId(null);
  };

  /** Revoke a partnership, or withdraw an invitation that was never answered. */
  const handleRemovePartner = async (shareId: string, wasPending: boolean) => {
    setRemovingShareId(shareId);
    const supabase = createClient();
    const { error } = await untypedRpc(supabase, "cancel_habit_partner", {
      p_share_id: shareId,
    });

    if (error) {
      showToast({
        variant: "error",
        title: wasPending ? "Failed to withdraw invite" : "Failed to remove partner",
      });
    } else {
      showToast({
        variant: "info",
        title: wasPending ? "Invite withdrawn" : "Partner removed",
      });
      router.refresh();
    }
    setRemovingShareId(null);
  };

  /** Answer someone who asked to follow this habit. */
  const handleRespond = async (shareId: string, accept: boolean) => {
    setRespondingId(shareId);
    const supabase = createClient();
    const { error } = await untypedRpc(supabase, "respond_habit_partner", {
      p_share_id: shareId,
      p_accept: accept,
    });

    if (error) {
      showToast({ variant: "error", title: "Failed to answer request" });
    } else {
      showToast({
        variant: accept ? "success" : "info",
        title: accept ? "Partner added" : "Request declined",
      });
      router.refresh();
    }
    setRespondingId(null);
  };

  const handleRemoveGroupShare = useCallback(
    async (shareId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("group_habit_shares")
        .delete()
        .eq("id", shareId);
      if (error) {
        showToast({ variant: "error", title: "Failed to unshare" });
      } else {
        showToast({ variant: "info", title: "Removed from group" });
        router.refresh();
      }
    },
    [router, showToast],
  );

  const handleHabitSaved = useCallback(
    (updates: Partial<Habit>) => {
      setHabit((h) => ({ ...h, ...updates }));
      // The dashboard reads from the React Query cache, not from the server
      // render router.refresh() redoes — patch it so the new values show the
      // moment the user goes back, offline included, then refetch to confirm.
      queryClient.setQueriesData<DashboardData>(
        { queryKey: DASHBOARD_KEY_PREFIX },
        (old) => applyHabitUpdate(old, habit.id, updates),
      );
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
      router.refresh();
    },
    [router, queryClient, habit.id],
  );

  // --- Render ---

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* The habit is the TopBar's title, and edit and share are the
            bar's buttons. One line: a second under it left the 56px bar no
            room to breathe. The description and visibility are facts about
            the habit, so they are in the Overview's details with the rest. */}
        <TopBarTitle>
          <h1 className={TOP_BAR_TITLE_CLASS} style={TOP_BAR_TITLE_STYLE}>
            <span aria-hidden="true">{habit.emoji}</span> {habit.title}
          </h1>
        </TopBarTitle>
        <TopBarActions>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className={TOP_BAR_ICON_BUTTON_CLASS}
            aria-label="Edit habit"
          >
            <Pencil className="w-5 h-5" />
          </button>
          {/* An occasional action, so it sits with edit rather than as a band
              under the stats. The milestone toast carries the
              discoverability instead — it offers sharing at the one moment the
              streak has just moved. */}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className={TOP_BAR_ICON_BUTTON_CLASS}
            aria-label="Share your streak"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </TopBarActions>

        {/* Hero stats row */}
        <div className="flex gap-3 mb-6">
          <StatCard
            icon={Flame}
            label="Current"
            value={habit.streak_current ?? 0}
            color="var(--color-streak)"
          />
          <StatCard
            icon={Trophy}
            label="Best"
            value={habit.streak_best ?? 0}
            color="var(--color-brand-ink)"
          />
          <StatCard
            icon={Target}
            label="Total"
            value={habit.total_completions ?? 0}
            color="var(--color-success)"
          />
          <StatCard
            icon={TrendingUp}
            label="Rate"
            value={`${completionRate}%`}
            color="var(--color-encourage)"
          />
        </div>


        {/* Complete button. Still there once the habit is done today: doing
            it again is logged and shared like the first time, it just
            doesn't add to the streak. */}
        {!habit.is_paused && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Button
              className="w-full"
              variant={completedToday ? "secondary" : "primary"}
              onClick={async () => {
                // The first check-in that would reach a partner or a group
                // waits for a yes — asked before the sheet opens, so "not
                // now" never throws away a take or a note.
                if (await confirmSharing([habit.id])) setCompletionOpen(true);
              }}
            >
              {completedToday ? "Log another check-in" : "Log completion"}
            </Button>
          </motion.div>
        )}

        {completedToday && (
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            <Zap className="w-4 h-4" />
            <span>
              Completed today
              {checkInsToday > 1 && ` · ${checkInsToday} check-ins`}
            </span>
          </div>
        )}

        {/* A rain check settles the day without closing it off — the button
            above stays, so the habit can still be done for real. */}
        {rainCheckedToday && !completedToday && (
          <div
            className="mb-6 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{
              color: "var(--color-rain)",
              backgroundColor:
                "color-mix(in srgb, var(--color-rain) 12%, transparent)",
            }}
          >
            <CloudRain className="w-4 h-4" />
            <span>
              {rainCheckMovedToToday
                ? `Moved to ${weekdayName(rainCheckMovedToToday)} — check in then to keep your streak`
                : "Rain check today — your streak is safe"}
            </span>
          </div>
        )}

        {habit.is_paused && (
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <Pause className="w-4 h-4" />
            <span>This habit is paused</span>
          </div>
        )}

        {/* Tabs */}
        <Tabs.Root defaultValue="overview">
          <Tabs.List
            className="flex gap-1 p-1 rounded-lg bg-elevated shadow-sm mb-6"
            aria-label="Habit detail sections"
          >
            <Tabs.Trigger value="overview" className={TAB_TRIGGER_CLASS}>
              Overview
            </Tabs.Trigger>
            <Tabs.Trigger value="history" className={TAB_TRIGGER_CLASS}>
              History
            </Tabs.Trigger>
            <Tabs.Trigger value="friends" className={TAB_TRIGGER_CLASS}>
              Friends
            </Tabs.Trigger>
            <Tabs.Trigger value="settings" className={TAB_TRIGGER_CLASS}>
              Settings
            </Tabs.Trigger>
          </Tabs.List>

          {/* --- Overview Tab --- */}
          <Tabs.Content value="overview" className="space-y-6">
            {/* Heatmap */}
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                Last 90 days
              </h3>
              <div className="rounded-lg bg-elevated p-4 shadow-sm">
                <CalendarHeatmap data={heatmapData} rainCheckDates={rainCheckDates} color={habit.color ?? undefined} timezone={timezone} />
              </div>
            </div>

            {/* Details. The description leads, in full: this is the only
                place it is shown. */}
            <div className="rounded-lg bg-elevated p-4 shadow-sm space-y-3">
              {habit.description && (
                <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-line break-words pb-3 border-b border-border">
                  {habit.description}
                </p>
              )}
              <DetailRow label="Frequency" value={FREQUENCY_LABELS[habit.frequency] ?? habit.frequency} />
              {/* The picker's own words, so the row and the edit sheet agree. */}
              <DetailRow
                label="Visibility"
                value={habit.visibility === "public" ? "Public" : "Private"}
              />
              <DetailRow
                label="Created"
                value={habit.created_at ? format(new Date(habit.created_at), "MMM d, yyyy") : "—"}
              />
              <TimeWindowDetail habit={habit} />
            </div>
          </Tabs.Content>

          {/* --- History Tab --- */}
          <Tabs.Content value="history">
            {completions.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  No completions yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {completions.map((c) => (
                  <CompletionRow key={c.id} completion={c} />
                ))}
                {hasMore && (
                  <div ref={setHistoryEnd} className="flex flex-col items-center gap-1 pt-2">
                    {loadFailed && (
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        Couldn&rsquo;t load older entries.
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={loadingMore}
                      onClick={loadMoreCompletions}
                    >
                      {loadFailed ? "Try again" : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Tabs.Content>

          {/* --- Friends Tab --- */}
          <Tabs.Content value="friends" className="space-y-4">
            {/* Requests first — they are the only thing here waiting on you. */}
            {requests.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Requested
                </p>
                {requests.map((row) => (
                  <div
                    key={row.shareId}
                    className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm ring-1 ring-brand-ink/30"
                  >
                    <Avatar
                      src={row.profile.avatar_url}
                      name={row.profile.display_name}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {row.profile.display_name}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        @{row.profile.username}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRespond(row.shareId, false)}
                        disabled={respondingId === row.shareId}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors disabled:opacity-50"
                        aria-label={`Decline ${row.profile.display_name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <Button
                        size="sm"
                        loading={respondingId === row.shareId}
                        disabled={respondingId === row.shareId}
                        onClick={() => handleRespond(row.shareId, true)}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Accepted partners */}
            {partners.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Partners
                </p>
                {partners.map((row) => (
                  <div
                    key={row.shareId}
                    className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
                  >
                    <Avatar
                      src={row.profile.avatar_url}
                      name={row.profile.display_name}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {row.profile.display_name}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        @{row.profile.username}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePartner(row.shareId, false)}
                      disabled={removingShareId === row.shareId}
                      className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors disabled:opacity-50"
                      aria-label={`Remove ${row.profile.display_name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Sent, unanswered. Shown muted: there is nothing to do but wait
                or take it back. */}
            {invited.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Invited
                </p>
                {invited.map((row) => (
                  <div
                    key={row.shareId}
                    className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm opacity-75"
                  >
                    <Avatar
                      src={row.profile.avatar_url}
                      name={row.profile.display_name}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {row.profile.display_name}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        Waiting for them to accept
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePartner(row.shareId, true)}
                      disabled={removingShareId === row.shareId}
                      className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors disabled:opacity-50"
                      aria-label={`Withdraw invite to ${row.profile.display_name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Invite picker */}
            {availableFriends.length > 0 && !showAddFriend && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setShowAddFriend(true)}
              >
                <UserPlus className="w-4 h-4" />
                <span>Invite accountability partner</span>
              </Button>
            )}

            {showAddFriend && availableFriends.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    Choose a friend to invite
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowAddFriend(false)}
                    className="p-1 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <X className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                  </button>
                </div>
                <FriendPicker
                  friends={availableFriends}
                  selectedIds={[]}
                  onToggle={() => {}}
                  onAdd={handleAddFriend}
                  loadingId={addingFriendId}
                  mode="single"
                  searchPlaceholder="Search friends to invite…"
                />
              </div>
            )}

            {/* Shared with Groups */}
            {sharedGroups.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  Shared with groups
                </p>
                {sharedGroups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
                  >
                    {group.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={group.avatar_url}
                        alt={group.name}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-brand-light flex items-center justify-center flex-shrink-0">
                        <Users className="w-4 h-4 text-brand-ink" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {group.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveGroupShare(group.shareId)}
                      className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors"
                      aria-label={`Remove from ${group.name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {partnerRows.length === 0 && availableFriends.length === 0 && sharedGroups.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">👥</div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-1">
                  No accountability partners yet
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Add friends first, then invite them to follow this habit
                </p>
              </div>
            )}
          </Tabs.Content>

          {/* --- Settings Tab --- */}
          <Tabs.Content value="settings" className="space-y-4">
            {/* Edit habit */}
            <div className="rounded-lg bg-elevated p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    Edit habit
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    Change name, icon, schedule, or color
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="w-4 h-4" />
                  <span>Edit</span>
                </Button>
              </div>
            </div>

            {/* Pause / Resume */}
            <div className="rounded-lg bg-elevated p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {habit.is_paused ? "Resume habit" : "Pause habit"}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {habit.is_paused
                      ? "Resume to start tracking again"
                      : "Pausing keeps your streak but hides from dashboard"}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePauseToggle}
                  loading={isPausing}
                >
                  {habit.is_paused ? (
                    <Play className="w-4 h-4" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                  <span>{habit.is_paused ? "Resume" : "Pause"}</span>
                </Button>
              </div>
            </div>

            {/* Delete */}
            <div className="rounded-lg bg-elevated p-4 shadow-sm border border-red-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-miss">
                    Delete habit
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    This permanently deletes all completions and data
                  </p>
                </div>
                {!deleteConfirm ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 className="w-4 h-4 text-miss" />
                    <span className="text-miss">Delete</span>
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleDelete}
                      loading={isDeleting}
                      className="bg-miss hover:bg-red-600 text-white"
                    >
                      Confirm
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      {/* Completion Sheet */}
      <CompletionForm
        open={completionOpen}
        onOpenChange={setCompletionOpen}
        habitId={habit.id}
        habitTitle={habit.title}
        habitEmoji={habit.emoji ?? "✅"}
        habitSchedule={habit.schedule}
        timezone={timezone}
        defaultPrivate={habit.private_checkins}
        allowRainCheck={!completedToday && !rainCheckedToday}
        onComplete={handleCompletion}
      />

      {/* Edit habit sheet */}
      <EditHabitSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        habit={habit}
        onSaved={handleHabitSaved}
        showToast={showToast}
      />

      {/* Share card */}
      <ShareCardSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={habit.title}
        streak={habit.streak_current ?? 0}
        unit={streakUnit}
        username={username}
        evidencePaths={evidencePaths}
      />

      {/* Streak celebration */}
      <StreakCelebration active={showConfetti} onDone={dismissConfetti} />
      {ToastElements}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="flex-1 rounded-lg bg-elevated p-3 shadow-sm text-center">
      <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
      <p
        className="font-mono font-bold text-[var(--color-text-primary)]"
        style={{ fontSize: "var(--text-xl)" }}
      >
        {value}
      </p>
      <p className="text-xs text-[var(--color-text-tertiary)]">{label}</p>
    </div>
  );
}

/**
 * The habit's window, one line per time when some days keep a different
 * one: "Weekdays · 8 AM – 9 AM", "Weekends · Any time". Left out with no
 * window at all.
 */
function TimeWindowDetail({ habit }: { habit: Habit }) {
  const groups = timeWindowGroups(
    parseTimeWindow(habit.time_window),
    getScheduledDays(habit.schedule),
  ).filter((g) => g.days.length > 0);
  if (groups.length === 0) return null;

  const time = (window: DayWindow | null) => (window ? formatWindow(window) : "Any time");

  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-[var(--color-text-secondary)]">Time window</span>
      <span className="text-sm font-medium text-[var(--color-text-primary)] text-right">
        {groups.length === 1
          ? time(groups[0].window)
          : groups.map((g) => (
              <span key={g.days.join()} className="block">
                {describeDays(g.days)} · {time(g.window)}
              </span>
            ))}
      </span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="text-sm font-medium text-[var(--color-text-primary)] capitalize">
        {value}
      </span>
    </div>
  );
}

/**
 * One entry in the History tab.
 *
 * A habit kept for years builds up thousands of these, many with media, so a
 * row only mounts its photo, video or audio while it is near the screen, and
 * gives the space back to a placeholder of the same size once it scrolls far
 * away. `content-visibility` lets the browser skip laying out rows that are
 * off screen entirely.
 */
export function CompletionRow({ completion }: { completion: Completion }) {
  const cType = completion.completion_type ?? "quick";
  const Icon = COMPLETION_ICONS[cType] ?? Zap;
  const label = COMPLETION_LABELS[cType] ?? "Completion";
  // A skip is not an achievement — it gets the rain hue, not success green.
  const accent = isRainCheck(cType) ? "var(--color-rain)" : "var(--color-success)";

  const rowRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(rowRef);
  const [photoOpen, setPhotoOpen] = useState(false);

  const evidence = completion.evidence_url;
  const hasMedia =
    !!evidence && (cType === "photo" || cType === "video" || cType === "voice");

  return (
    <div
      ref={rowRef}
      className="flex items-start gap-3 rounded-lg bg-elevated p-4 shadow-sm"
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${hasMedia && cType !== "voice" ? 260 : 96}px`,
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)`,
        }}
      >
        <Icon className="w-4 h-4" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-primary)]">
            {label}
            {completion.is_private && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-[var(--color-text-tertiary)]">
                <Lock className="w-3 h-3" aria-hidden />
                Only you
              </span>
            )}
          </p>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {formatDistanceToNow(new Date(completion.completed_at), {
              addSuffix: true,
            })}
          </span>
        </div>

        {/* Content preview */}
        {cType === "photo" && evidence && (
          <>
            <button
              type="button"
              onClick={() => setPhotoOpen(true)}
              aria-label="View photo full size"
              className="relative mt-2 block w-full rounded-md overflow-hidden bg-[var(--color-bg-secondary)] h-48 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
            >
              {near && (
                <EvidenceMedia
                  path={evidence}
                  type="photo"
                  alt="Photo proof"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </button>
            {photoOpen && (
              <MediaLightbox
                path={evidence}
                open={photoOpen}
                onOpenChange={setPhotoOpen}
                alt="Photo proof"
              />
            )}
          </>
        )}
        {cType === "video" && evidence && (
          <div className="mt-2 rounded-md overflow-hidden bg-[var(--color-bg-secondary)] h-48">
            {near && (
              <EvidenceMedia
                path={evidence}
                type="video"
                className="w-full h-full object-contain"
              />
            )}
          </div>
        )}
        {cType === "voice" && evidence && (
          <div className="mt-2 h-9">
            {near && <EvidenceAudio path={evidence} />}
          </div>
        )}

        {/* What was written with it: the message itself, or a caption */}
        {!isRainCheck(cType) && completion.notes && (
          <ClampedNote
            text={completion.notes}
            className={hasMedia ? "mt-2" : "mt-1"}
          />
        )}
        {isRainCheck(cType) && (
          <div className="mt-1 space-y-1">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {completion.rain_check_moved_to
                ? `Moved to ${weekdayName(completion.rain_check_moved_to)} · ${rainCheckReasonLabel(completion.rain_check_reason)}`
                : rainCheckReasonLabel(completion.rain_check_reason)}
            </p>
            {completion.notes && <ClampedNote text={completion.notes} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A note cut to three lines, with a toggle to read the rest — offered only
 * when the clamp actually hides something.
 */
function ClampedNote({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className={cn(
          "text-sm text-[var(--color-text-secondary)] italic whitespace-pre-line break-words",
          !expanded && "line-clamp-3",
        )}
      >
        &ldquo;{text}&rdquo;
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium text-brand-ink hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
