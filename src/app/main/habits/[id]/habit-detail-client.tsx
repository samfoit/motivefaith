"use client";

import React, { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowLeft,
  Camera,
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
  Mic,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { toDateKey, todayDateKey } from "@/lib/utils/timezone";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EvidenceMedia } from "@/components/ui/EvidenceMedia";
import { EvidenceAudio } from "@/components/ui/EvidenceAudio";
import { FriendPicker } from "@/components/social/FriendPicker";
import { CalendarHeatmap } from "@/components/habits/CalendarHeatmap";
import { useCompleteHabit } from "@/lib/hooks/useCompleteHabit";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Habit = Tables<"habits">;

type Completion = {
  id: string;
  habit_id: string;
  completion_type: Tables<"completions">["completion_type"];
  evidence_url: string | null;
  notes: string | null;
  completed_at: string;
};

type Share = {
  id: string;
  shared_with: string | null;
  notify_complete: boolean | null;
  notify_miss: boolean | null;
  created_at: string | null;
};

type Partner = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username: string;
};

type SharedGroup = {
  id: string;
  name: string;
  avatar_url: string | null;
  shareId: string;
};

interface HabitDetailClientProps {
  habit: Habit;
  completions: Completion[];
  shares: Share[];
  partners: Partner[];
  availableFriends?: Partner[];
  sharedGroups?: SharedGroup[];
  timezone: string;
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
};

const COMPLETION_LABELS: Record<string, string> = {
  quick: "Quick check-in",
  photo: "Photo proof",
  video: "Video proof",
  message: "Reflection",
  voice: "Voice message",
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

const TAB_TRIGGER_CLASS = cn(
  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
  "text-[var(--color-text-secondary)]",
  "data-[state=active]:bg-brand data-[state=active]:text-white",
  "hover:text-[var(--color-text-primary)]",
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HabitDetailClient({
  habit: initialHabit,
  completions: initialCompletions,
  shares,
  partners,
  availableFriends = [],
  sharedGroups = [],
  timezone,
}: HabitDetailClientProps) {
  const router = useRouter();
  const completeHabit = useCompleteHabit();
  const { show: showToast, ToastElements } = useToast();
  const [habit, setHabit] = useState(initialHabit);
  const [completions, setCompletions] = useState(initialCompletions);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialCompletions.length >= 50);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [addingFriendId, setAddingFriendId] = useState<string | null>(null);
  const [removingShareId, setRemovingShareId] = useState<string | null>(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const dismissConfetti = useCallback(() => setShowConfetti(false), []);

  const loadMoreCompletions = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const supabase = createClient();
    const oldest = completions[completions.length - 1]?.completed_at;
    if (!oldest) { setLoadingMore(false); return; }
    const { data } = await supabase
      .from("completions")
      .select("id, habit_id, completion_type, evidence_url, notes, completed_at")
      .eq("habit_id", habit.id)
      .lt("completed_at", oldest)
      .order("completed_at", { ascending: false })
      .limit(50);
    const more = (data ?? []).filter(
      (c): c is typeof c & { completed_at: string } => c.completed_at != null,
    );
    setCompletions((prev) => [...prev, ...more]);
    setHasMore(more.length >= 50);
    setLoadingMore(false);
  }, [completions, habit.id, hasMore, loadingMore]);

  // --- Derived data ---

  const heatmapData = useMemo(() => {
    const map: Record<string, number> = {};
    completions.forEach((c) => {
      const key = toDateKey(c.completed_at, timezone);
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [completions, timezone]);

  const completedToday = useMemo(() => {
    const today = todayDateKey(timezone);
    return completions.some(
      (c) => toDateKey(c.completed_at, timezone) === today,
    );
  }, [completions, timezone]);

  const [mountTime] = useState(() => Date.now());
  const completionRate = useMemo(() => {
    const totalComp = habit.total_completions ?? 0;
    if (totalComp === 0) return 0;
    const createdMs = habit.created_at
      ? new Date(habit.created_at).getTime()
      : mountTime;
    const daysSinceCreation = Math.max(
      1,
      Math.ceil((mountTime - createdMs) / (1000 * 60 * 60 * 24)),
    );
    return Math.min(100, Math.round((totalComp / daysSinceCreation) * 100));
  }, [habit.total_completions, habit.created_at, mountTime]);

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
      });
    },
    [showToast, habit.title, streakUnit],
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
    const prevStreak = habit.streak_current ?? 0;

    // Optimistic update
    const tempCompletion: Completion = {
      id: `temp-${Date.now()}`,
      habit_id: habit.id,
      completion_type: type,
      evidence_url: evidenceUrl ?? null,
      notes: notes ?? null,
      completed_at: new Date().toISOString(),
    };
    setCompletions((prev) => [tempCompletion, ...prev]);
    setHabit((h) => ({
      ...h,
      streak_current: (h.streak_current ?? 0) + 1,
      total_completions: (h.total_completions ?? 0) + 1,
    }));

    try {
      await completeHabit.mutateAsync({ habitId: habit.id, type, evidenceUrl, notes });
      checkMilestone(prevStreak + 1);
      router.refresh();
    } catch {
      setCompletions(initialCompletions);
      setHabit(initialHabit);
      showToast({ variant: "error", title: "Failed to log completion" });
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
      router.replace("/main/dashboard");
      router.refresh();
    }
  };

  const handleAddFriend = async (friendId: string) => {
    setAddingFriendId(friendId);
    const supabase = createClient();
    const { error } = await supabase.from("habit_shares").insert({
      habit_id: habit.id,
      shared_with: friendId,
    });

    if (error) {
      showToast({ variant: "error", title: "Failed to share habit" });
    } else {
      showToast({ variant: "success", title: "Habit shared!" });
      router.refresh();
    }
    setAddingFriendId(null);
  };

  const handleRemovePartner = async (shareId: string) => {
    setRemovingShareId(shareId);
    const supabase = createClient();
    const { error } = await supabase
      .from("habit_shares")
      .delete()
      .eq("id", shareId);

    if (error) {
      showToast({ variant: "error", title: "Failed to remove partner" });
    } else {
      showToast({ variant: "info", title: "Partner removed" });
      router.refresh();
    }
    setRemovingShareId(null);
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
      router.refresh();
    },
    [router],
  );

  // --- Render ---

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-4">
        {/* Back button + header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{habit.emoji}</span>
              <h1
                className="font-display font-bold text-[var(--color-text-primary)] truncate"
                style={{ fontSize: "var(--text-xl)" }}
              >
                {habit.title}
              </h1>
              <button
                onClick={() => setEditOpen(true)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors flex-shrink-0"
                aria-label="Edit habit"
              >
                <Pencil className="w-4 h-4 text-[var(--color-text-tertiary)]" />
              </button>
            </div>
            {habit.description && (
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5 truncate">
                {habit.description}
              </p>
            )}
          </div>
        </div>

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
            color="var(--color-brand)"
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

        {/* Complete button */}
        {!completedToday && !habit.is_paused && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <Button
              className="w-full"
              onClick={() => setCompletionOpen(true)}
            >
              Log completion
            </Button>
          </motion.div>
        )}

        {completedToday && (
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            <Zap className="w-4 h-4" />
            <span>Completed today</span>
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
            className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary)] mb-6"
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
                <CalendarHeatmap data={heatmapData} color={habit.color ?? undefined} timezone={timezone} />
              </div>
            </div>

            {/* Details */}
            <div className="rounded-lg bg-elevated p-4 shadow-sm space-y-3">
              <DetailRow label="Frequency" value={FREQUENCY_LABELS[habit.frequency] ?? habit.frequency} />
              <DetailRow label="Category" value={habit.category ?? "general"} />
              <DetailRow
                label="Created"
                value={habit.created_at ? format(new Date(habit.created_at), "MMM d, yyyy") : "—"}
              />
              {habit.time_window && (
                <DetailRow
                  label="Time window"
                  value={`${(habit.time_window as { start?: string }).start ?? "–"} – ${(habit.time_window as { end?: string }).end ?? "–"}`}
                />
              )}
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
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={loadingMore}
                      onClick={loadMoreCompletions}
                    >
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Tabs.Content>

          {/* --- Friends Tab --- */}
          <Tabs.Content value="friends" className="space-y-4">
            {/* Current partners */}
            {partners.length > 0 && (
              <div className="space-y-2">
                {partners.map((partner) => {
                  const share = shares.find(
                    (s) => s.shared_with === partner.id,
                  );
                  return (
                    <div
                      key={partner.id}
                      className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
                    >
                      <Avatar
                        src={partner.avatar_url}
                        name={partner.display_name}
                        size="sm"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {partner.display_name}
                        </p>
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          @{partner.username}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                          {share?.notify_complete && (
                            <span title="Notified on completion">✅</span>
                          )}
                          {share?.notify_miss && (
                            <span title="Notified on miss">⏰</span>
                          )}
                        </div>
                        {share && (
                          <button
                            type="button"
                            onClick={() => handleRemovePartner(share.id)}
                            disabled={removingShareId === share.id}
                            className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors disabled:opacity-50"
                            aria-label={`Remove ${partner.display_name}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add friend picker */}
            {availableFriends.length > 0 && !showAddFriend && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setShowAddFriend(true)}
              >
                <UserPlus className="w-4 h-4" />
                <span>Add accountability partner</span>
              </Button>
            )}

            {showAddFriend && availableFriends.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    Choose a friend
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
                  searchPlaceholder="Search friends to add…"
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
                        <Users className="w-4 h-4 text-brand" />
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
            {partners.length === 0 && availableFriends.length === 0 && sharedGroups.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">👥</div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-1">
                  No accountability partners yet
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Add friends first, then share this habit with them
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
                    Change name, icon, schedule, or category
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

function CompletionRow({ completion }: { completion: Completion }) {
  const cType = completion.completion_type ?? "quick";
  const Icon = COMPLETION_ICONS[cType] ?? Zap;
  const label = COMPLETION_LABELS[cType] ?? "Completion";

  return (
    <div className="flex items-start gap-3 rounded-lg bg-elevated p-4 shadow-sm">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-success) 15%, transparent)",
        }}
      >
        <Icon className="w-4 h-4 text-success" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {label}
          </p>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {formatDistanceToNow(new Date(completion.completed_at), {
              addSuffix: true,
            })}
          </span>
        </div>

        {/* Content preview */}
        {completion.completion_type === "photo" && completion.evidence_url && (
          <div className="relative mt-2 rounded-md overflow-hidden bg-[var(--color-bg-secondary)] h-48">
            <EvidenceMedia
              path={completion.evidence_url}
              type="photo"
              alt="Photo proof"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        )}
        {completion.completion_type === "video" && completion.evidence_url && (
          <div className="mt-2 rounded-md overflow-hidden bg-[var(--color-bg-secondary)]">
            <EvidenceMedia
              path={completion.evidence_url}
              type="video"
              className="w-full max-h-48"
            />
          </div>
        )}
        {completion.completion_type === "message" && completion.notes && (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)] line-clamp-3 italic">
            &ldquo;{completion.notes}&rdquo;
          </p>
        )}
        {completion.completion_type === "voice" && completion.evidence_url && (
          <div className="mt-2">
            <EvidenceAudio path={completion.evidence_url} />
          </div>
        )}
      </div>
    </div>
  );
}
