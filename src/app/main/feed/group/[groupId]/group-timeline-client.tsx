"use client";

import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  Heart,
  MoreHorizontal,
  Send,
  Settings,
  Link2,
  Trophy,
  LogOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import dynamic from "next/dynamic";
import { useToast } from "@/components/ui/Toast";
import { GroupChallengeCard } from "@/components/social/GroupChallengeCard";
import type { ChallengeFormData } from "@/components/social/CreateChallengeSheet";

const InviteLinkSheet = dynamic(
  () => import("@/components/social/InviteLinkSheet").then((m) => m.InviteLinkSheet),
  { ssr: false },
);
const CreateChallengeSheet = dynamic(
  () => import("@/components/social/CreateChallengeSheet").then((m) => m.CreateChallengeSheet),
  { ssr: false },
);
import { motion } from "motion/react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { createClient } from "@/lib/supabase/client";
import { useRegenerateInviteCode, useRemoveGroupMember } from "@/lib/hooks/useGroups";
import { useCreateChallenge, useJoinChallenge, useLeaveChallenge } from "@/lib/hooks/useGroupChallenges";
import { ReportSheet } from "@/components/social/ReportSheet";
import { CompletionBubble, slideVariant } from "@/components/social/CompletionBubble";
import type {
  GroupTimelineData,
  GroupTimelineMessage,
  GroupMessageReaction,
} from "@/lib/types/groups";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GroupTimelineClientProps {
  data: GroupTimelineData;
  userId: string;
}

export function GroupTimelineClient({ data, userId }: GroupTimelineClientProps) {
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const { group, members, habits, completions, challenges, myRole } = data;

  // Pending messages (optimistic sends)
  const [pendingMessages, setPendingMessages] = useState<GroupTimelineMessage[]>([]);

  // Optimistic reactions: map of messageId → added/removed reactions
  const [optimisticReactions, setOptimisticReactions] = useState<
    Map<string, GroupMessageReaction[]>
  >(new Map());

  const mergedMessages = useMemo(() => {
    const serverIds = new Set(data.messages.map((m) => m.id));
    const unconfirmed = pendingMessages.filter((m) => !serverIds.has(m.id));
    const allMessages = [...data.messages, ...unconfirmed];

    // Apply optimistic reactions
    if (optimisticReactions.size === 0) return allMessages;

    return allMessages.map((m) => {
      const optimistic = optimisticReactions.get(m.id);
      if (!optimistic) return m;
      // Merge: start from server reactions, add optimistic ones not already present
      const serverReactions = m.reactions ?? [];
      const serverIds = new Set(serverReactions.map((r) => r.user_id));
      const merged = [...serverReactions];
      for (const r of optimistic) {
        if (!serverIds.has(r.user_id)) merged.push(r);
      }
      return { ...m, reactions: merged };
    });
  }, [data.messages, pendingMessages, optimisticReactions]);

  // Optimistic completion reactions: map of completionId → added reactions
  const [optimisticCompletionReactions, setOptimisticCompletionReactions] = useState<
    Map<string, GroupMessageReaction[]>
  >(new Map());

  const mergedCompletions = useMemo(() => {
    if (optimisticCompletionReactions.size === 0) return completions;

    return completions.map((c) => {
      const optimistic = optimisticCompletionReactions.get(c.id);
      if (!optimistic) return c;
      const serverReactions = c.reactions ?? [];
      const existingUserIds = new Set(serverReactions.map((r) => r.user_id));
      const merged = [...serverReactions];
      for (const r of optimistic) {
        if (!existingUserIds.has(r.user_id)) merged.push(r);
      }
      return { ...c, reactions: merged };
    });
  }, [completions, optimisticCompletionReactions]);

  // Invite sheet
  const [inviteOpen, setInviteOpen] = useState(false);
  const regenerateCode = useRegenerateInviteCode();

  // Challenge sheet
  const [challengeSheetOpen, setChallengeSheetOpen] = useState(false);
  const createChallenge = useCreateChallenge();
  const joinChallenge = useJoinChallenge();
  const leaveChallenge = useLeaveChallenge();
  const [joiningChallengeId, setJoiningChallengeId] = useState<string | null>(null);

  // Report
  const [reportTarget, setReportTarget] = useState<{
    contentType: "completion" | "message";
    contentId: string;
  } | null>(null);

  // 24-hour cutoff
  const [cutoff] = useState(() => Date.now() - 24 * 60 * 60 * 1000);

  // Leave group
  const removeGroupMember = useRemoveGroupMember();
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const handleLeaveGroup = useCallback(async () => {
    setIsLeaving(true);
    try {
      await removeGroupMember.mutateAsync({ groupId: group.id, userId });
      router.replace("/main/feed");
    } catch {
      showToast({ variant: "error", title: "Failed to leave group" });
      setIsLeaving(false);
      setLeaveConfirmOpen(false);
    }
  }, [group.id, userId, removeGroupMember, router, showToast]);

  // Habits expand
  const HABITS_PREVIEW_COUNT = 4;
  const [habitsExpanded, setHabitsExpanded] = useState(false);
  const visibleHabits = useMemo(
    () => (habitsExpanded ? habits : habits.slice(0, HABITS_PREVIEW_COUNT)),
    [habits, habitsExpanded],
  );
  const hasMoreHabits = habits.length > HABITS_PREVIEW_COUNT;

  // Debounced refresh
  const lastRefresh = useRef(0);
  const debouncedRefresh = useCallback(() => {
    if (Date.now() - lastRefresh.current < 2000) return;
    lastRefresh.current = Date.now();
    router.refresh();
  }, [router]);

  // Realtime subscriptions
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`group-${group.id}`)
      .on<{
        id: string;
        group_id: string;
        user_id: string;
        content: string;
        created_at: string;
      }>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=eq.${group.id}`,
        },
        (payload) => {
          const row = payload.new;
          if (row.user_id === userId) return; // Already handled optimistically

          const memberProfile = members.find((m) => m.user_id === row.user_id);
          const newMsg: GroupTimelineMessage = {
            id: row.id,
            content: row.content,
            created_at: row.created_at,
            user_id: row.user_id,
            isMe: false,
            user_name: memberProfile?.profile.display_name ?? "Unknown",
            user_avatar: memberProfile?.profile.avatar_url ?? null,
          };

          setPendingMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          setTimeout(() => {
            timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 50);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_message_reactions",
        },
        (payload) => {
          const row = payload.new as { user_id?: string } | undefined;
          // Skip own reactions (handled optimistically)
          if (row?.user_id === userId) return;
          debouncedRefresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_completion_reactions",
        },
        (payload) => {
          const row = payload.new as { user_id?: string } | undefined;
          if (row?.user_id === userId) return;
          debouncedRefresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "completions" },
        () => debouncedRefresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_members",
          filter: `group_id=eq.${group.id}`,
        },
        () => debouncedRefresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_habit_shares",
          filter: `group_id=eq.${group.id}`,
        },
        () => debouncedRefresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [group.id, userId, members, debouncedRefresh]);

  // Focus/visibility refresh
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") debouncedRefresh();
    };
    const onFocus = () => debouncedRefresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [debouncedRefresh]);

  // Toggle heart reaction on a message
  const toggleReaction = useCallback(
    async (messageId: string, currentReactions: GroupMessageReaction[]) => {
      const supabase = createClient();
      const existing = currentReactions.find((r) => r.user_id === userId);

      if (existing) {
        // Remove optimistic reaction
        setOptimisticReactions((prev) => {
          const next = new Map(prev);
          next.delete(messageId);
          return next;
        });

        const { error } = await supabase
          .from("group_message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", userId);

        if (error) {
          // Restore on failure
          setOptimisticReactions((prev) => {
            const next = new Map(prev);
            next.set(messageId, [existing]);
            return next;
          });
          showToast({ variant: "error", title: "Failed to remove reaction" });
        } else {
          debouncedRefresh();
        }
      } else {
        // Add optimistic reaction
        const optimisticReaction: GroupMessageReaction = {
          id: `optimistic-${Date.now()}`,
          user_id: userId,
          emoji: "❤️",
        };

        setOptimisticReactions((prev) => {
          const next = new Map(prev);
          next.set(messageId, [optimisticReaction]);
          return next;
        });

        const { error } = await supabase
          .from("group_message_reactions")
          .insert({ message_id: messageId, user_id: userId, emoji: "❤️" });

        if (error) {
          // Remove on failure
          setOptimisticReactions((prev) => {
            const next = new Map(prev);
            next.delete(messageId);
            return next;
          });
          showToast({ variant: "error", title: "Failed to react" });
        } else {
          debouncedRefresh();
        }
      }
    },
    [userId, showToast, debouncedRefresh],
  );

  // Toggle heart reaction on a completion
  const toggleCompletionReaction = useCallback(
    async (completionId: string, currentReactions: GroupMessageReaction[]) => {
      const supabase = createClient();
      const existing = currentReactions.find((r) => r.user_id === userId);

      if (existing) {
        setOptimisticCompletionReactions((prev) => {
          const next = new Map(prev);
          next.delete(completionId);
          return next;
        });

        const { error } = await supabase
          .from("group_completion_reactions")
          .delete()
          .eq("completion_id", completionId)
          .eq("user_id", userId);

        if (error) {
          setOptimisticCompletionReactions((prev) => {
            const next = new Map(prev);
            next.set(completionId, [existing]);
            return next;
          });
          showToast({ variant: "error", title: "Failed to remove reaction" });
        } else {
          debouncedRefresh();
        }
      } else {
        const optimisticReaction: GroupMessageReaction = {
          id: `optimistic-${Date.now()}`,
          user_id: userId,
          emoji: "❤️",
        };

        setOptimisticCompletionReactions((prev) => {
          const next = new Map(prev);
          next.set(completionId, [optimisticReaction]);
          return next;
        });

        const { error } = await supabase
          .from("group_completion_reactions")
          .insert({ completion_id: completionId, user_id: userId, emoji: "❤️" });

        if (error) {
          setOptimisticCompletionReactions((prev) => {
            const next = new Map(prev);
            next.delete(completionId);
            return next;
          });
          showToast({ variant: "error", title: "Failed to react" });
        } else {
          debouncedRefresh();
        }
      }
    },
    [userId, showToast, debouncedRefresh],
  );

  // Send message
  const sendMessage = useCallback(async () => {
    const text = message.trim();
    if (!text || isSending) return;

    const myProfile = members.find((m) => m.user_id === userId);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: GroupTimelineMessage = {
      id: optimisticId,
      content: text,
      created_at: new Date().toISOString(),
      user_id: userId,
      isMe: true,
      user_name: myProfile?.profile.display_name ?? "You",
      user_avatar: myProfile?.profile.avatar_url ?? null,
    };

    setPendingMessages((prev) => [...prev, optimisticMsg]);
    setMessage("");
    inputRef.current?.focus();

    setTimeout(() => {
      timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    setIsSending(true);
    const supabase = createClient();

    const { data: inserted, error } = await supabase
      .from("group_messages")
      .insert({
        group_id: group.id,
        user_id: userId,
        content: text,
      })
      .select("id")
      .single();

    setIsSending(false);

    if (error) {
      setPendingMessages((prev) =>
        prev.filter((m) => m.id !== optimisticId),
      );
      setMessage(text);
      showToast({ variant: "error", title: "Failed to send" });
      return;
    }

    if (inserted) {
      setPendingMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, id: inserted.id } : m,
        ),
      );
    }

    debouncedRefresh();
  }, [message, isSending, userId, group.id, members, showToast, debouncedRefresh]);

  // Challenge handlers
  const handleCreateChallenge = async (formData: ChallengeFormData) => {
    await createChallenge.mutateAsync({
      groupId: group.id,
      createdBy: userId,
      title: formData.title,
      emoji: formData.emoji,
      description: formData.description || undefined,
      color: formData.color,
      category: formData.category,
      frequency: formData.frequency,
      schedule: { days: formData.scheduleDays },
      startDate: formData.startDate,
      endDate: formData.endDate || undefined,
      autoJoin: true,
    });
    showToast({ variant: "success", title: "Challenge created!" });
    debouncedRefresh();
  };

  const handleJoinChallenge = async (challengeId: string) => {
    const challenge = challenges.find((c) => c.id === challengeId);
    if (!challenge) return;

    setJoiningChallengeId(challengeId);
    try {
      await joinChallenge.mutateAsync({
        challengeId,
        userId,
        title: challenge.title,
        emoji: challenge.emoji ?? "🎯",
        color: challenge.color ?? "#6366F1",
        category: challenge.category ?? "general",
        frequency: challenge.frequency,
        schedule: (challenge.schedule ?? { days: [0, 1, 2, 3, 4, 5, 6] }) as { days: number[] },
      });
      showToast({ variant: "success", title: "Joined challenge!" });
      debouncedRefresh();
    } catch {
      showToast({ variant: "error", title: "Failed to join" });
    } finally {
      setJoiningChallengeId(null);
    }
  };

  const handleLeaveChallenge = async (challengeId: string) => {
    try {
      await leaveChallenge.mutateAsync({ challengeId, userId });
      showToast({ variant: "info", title: "Left challenge" });
      debouncedRefresh();
    } catch {
      showToast({ variant: "error", title: "Failed to leave" });
    }
  };

  // Build merged timeline (completions + messages, chronological, last 24h)
  const timeline = useMemo(() => {
    const entries: {
      type: "completion" | "message";
      id: string;
      timestamp: string;
      data: GroupTimelineData["completions"][number] | GroupTimelineMessage;
    }[] = [];

    for (const c of mergedCompletions) {
      if (new Date(c.completed_at).getTime() >= cutoff) {
        entries.push({
          type: "completion",
          id: c.id,
          timestamp: c.completed_at,
          data: c,
        });
      }
    }

    for (const m of mergedMessages) {
      if (new Date(m.created_at).getTime() >= cutoff) {
        entries.push({
          type: "message",
          id: m.id,
          timestamp: m.created_at,
          data: m,
        });
      }
    }

    entries.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return entries;
  }, [mergedCompletions, mergedMessages, cutoff]);

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-[var(--color-text-primary)] text-base truncate">
              {group.name}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {/* Stacked avatars */}
              <div className="flex -space-x-2">
                {members.slice(0, 5).map((m) => (
                  <div key={m.user_id} className="ring-2 ring-[var(--color-bg-primary)] rounded-full">
                    <Avatar
                      src={m.profile.avatar_url}
                      name={m.profile.display_name}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
              {members.length > 5 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  +{members.length - 5}
                </span>
              )}
              <Pill size="sm" variant="default">
                {members.length} members
              </Pill>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Invite"
            >
              <Link2 className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
            {myRole === "admin" ? (
              <button
                type="button"
                onClick={() => router.push(`/main/feed/group/${group.id}/settings`)}
                className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4 text-[var(--color-text-secondary)]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLeaveConfirmOpen(true)}
                disabled={isLeaving}
                className="p-2 rounded-lg hover:bg-miss/10 transition-colors"
                aria-label="Leave group"
              >
                <LogOut className="w-4 h-4 text-miss" />
              </button>
            )}
          </div>
        </div>

        {/* Shared Habits */}
        {habits.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2
                className="font-display font-semibold text-[var(--color-text-primary)]"
                style={{ fontSize: "var(--text-lg)" }}
              >
                Shared Habits
              </h2>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {habits.length} habit{habits.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="space-y-2">
              {visibleHabits.map((habit) => (
                <div
                  key={habit.id}
                  className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm border-l-[3px]"
                  style={{ borderLeftColor: habit.color }}
                >
                  <span className="text-xl leading-none">{habit.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {habit.title}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Avatar
                        src={habit.owner_avatar}
                        name={habit.owner_name}
                        size="sm"
                        className="!w-4 !h-4"
                      />
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {habit.owner_name}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {habit.completedToday ? (
                      <Pill variant="default" size="sm">
                        Done
                      </Pill>
                    ) : (
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        🔥 {habit.streak_current}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {hasMoreHabits && (
              <button
                type="button"
                onClick={() => setHabitsExpanded((v) => !v)}
                className={cn(
                  "w-full mt-2 py-2 rounded-lg text-sm font-medium",
                  "text-brand hover:bg-brand-light transition-colors",
                  "flex items-center justify-center gap-1",
                )}
              >
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform duration-200",
                    habitsExpanded && "rotate-180",
                  )}
                />
                {habitsExpanded
                  ? "Show less"
                  : `Show all ${habits.length} habits`}
              </button>
            )}
          </section>
        )}

        {/* Active Challenges */}
        {(challenges.length > 0 || myRole === "admin") && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2
                className="font-display font-semibold text-[var(--color-text-primary)]"
                style={{ fontSize: "var(--text-lg)" }}
              >
                Challenges
              </h2>
              {myRole === "admin" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setChallengeSheetOpen(true)}
                >
                  <Trophy className="w-4 h-4" />
                  <span>New</span>
                </Button>
              )}
            </div>
            {challenges.length > 0 ? (
              <div className="space-y-2">
                {challenges.map((challenge) => (
                  <GroupChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    onJoin={handleJoinChallenge}
                    onLeave={handleLeaveChallenge}
                    isLoading={joiningChallengeId === challenge.id}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">
                No active challenges yet
              </p>
            )}
          </section>
        )}

        {/* Timeline */}
        <section>
          <h2
            className="font-display font-semibold text-[var(--color-text-primary)] mb-3"
            style={{ fontSize: "var(--text-lg)" }}
          >
            Activity
          </h2>

          {timeline.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">
              No activity in the last 24 hours.
            </p>
          ) : (
            <div className="space-y-2">
              {timeline.map((entry) => {
                if (entry.type === "completion") {
                  const c = entry.data as GroupTimelineData["completions"][number];
                  const cReactions = c.reactions ?? [];
                  const cHeartCount = cReactions.length;
                  const cIHearted = cReactions.some((r) => r.user_id === userId);

                  return (
                    <CompletionBubble
                      key={entry.id}
                      isMe={c.isMe}
                      habitEmoji={c.habit_emoji}
                      habitTitle={c.habit_title}
                      habitColor={c.habit_color}
                      completionType={c.completion_type}
                      evidenceUrl={c.evidence_url}
                      notes={c.notes}
                      completedAt={c.completed_at}
                      heartCount={cHeartCount}
                      isHearted={cIHearted}
                      senderName={c.isMe ? undefined : c.user_name}
                      senderAvatar={c.isMe ? undefined : c.user_avatar}
                      onHeart={
                        !c.isMe
                          ? () => toggleCompletionReaction(c.id, cReactions)
                          : undefined
                      }
                      onReport={
                        !c.isMe
                          ? () =>
                              setReportTarget({
                                contentType: "completion",
                                contentId: c.id,
                              })
                          : undefined
                      }
                    />
                  );
                }

                // Message
                const m = entry.data as GroupTimelineMessage;
                const reactions = m.reactions ?? [];
                const heartCount = reactions.length;
                const iHearted = reactions.some((r) => r.user_id === userId);

                return (
                  <motion.div
                    key={entry.id}
                    variants={slideVariant(m.isMe)}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    className={cn("flex", m.isMe ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] flex items-end gap-1.5",
                        m.isMe && "flex-row-reverse",
                      )}
                    >
                      {!m.isMe && (
                        <Avatar
                          src={m.user_avatar}
                          name={m.user_name}
                          size="sm"
                          className="flex-shrink-0 mb-1"
                        />
                      )}

                      <div
                        className={cn(
                          "min-w-0 rounded-xl px-3.5 py-2.5 space-y-1",
                          m.isMe
                            ? "bg-brand text-white rounded-br-sm"
                            : "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded-bl-sm",
                        )}
                      >
                        {!m.isMe && (
                          <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
                            {m.user_name}
                          </p>
                        )}
                        <p className="text-sm break-words">{m.content}</p>
                        <div className="flex items-center gap-1.5">
                          <p
                            className={cn(
                              "text-[10px]",
                              m.isMe
                                ? "text-white/60"
                                : "text-[var(--color-text-tertiary)]",
                            )}
                          >
                            {format(new Date(m.created_at), "h:mm a")}
                          </p>
                          {m.isMe && heartCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-red-500">
                              <Heart className="w-3 h-3" fill="currentColor" />
                              {heartCount > 1 && (
                                <span className="text-[10px] font-medium">{heartCount}</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions — only on others' messages */}
                      {!m.isMe && (
                        <div className="flex flex-col items-center gap-0.5 mb-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setReportTarget({ contentType: "message", contentId: m.id })
                            }
                            className="p-1 rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                            aria-label="More options"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleReaction(m.id, reactions)}
                            className={cn(
                              "p-1.5 rounded-full transition-all",
                              iHearted
                                ? "text-red-500"
                                : "text-[var(--color-text-tertiary)] hover:text-red-400 active:scale-90",
                            )}
                            aria-label={iHearted ? "Remove heart" : "Heart this message"}
                          >
                            <Heart className="w-4 h-4" fill={iHearted ? "currentColor" : "none"} />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
          <div ref={timelineEndRef} />
        </section>
      </div>

      {/* Bottom message input */}
      <div className="fixed bottom-16 inset-x-0 z-30 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-secondary)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="max-w-2xl mx-auto flex items-center gap-2 px-4 py-3"
        >
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message the group..."
            maxLength={300}
            className={cn(
              "flex-1 min-w-0 rounded-full px-4 py-2.5 text-base",
              "bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]",
              "placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none focus:ring-2 focus:ring-brand/40",
              "transition-shadow",
            )}
          />
          <button
            type="submit"
            disabled={!message.trim() || isSending}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
              "transition-all",
              message.trim()
                ? "bg-brand text-white active:scale-95"
                : "bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)]",
            )}
            aria-label="Send message"
          >
            <Send className="w-4.5 h-4.5" />
          </button>
        </form>
      </div>

      {/* Sheets */}
      <InviteLinkSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        inviteCode={group.invite_code}
        isAdmin={myRole === "admin"}
        onRegenerate={async () => {
          await regenerateCode.mutateAsync(group.id);
          debouncedRefresh();
        }}
      />

      <CreateChallengeSheet
        open={challengeSheetOpen}
        onOpenChange={setChallengeSheetOpen}
        onSubmit={handleCreateChallenge}
      />

      {/* Leave group confirmation */}
      <RadixDialog.Root open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
          <RadixDialog.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
              "w-[min(90vw,360px)] rounded-xl bg-elevated p-6 shadow-lg",
              "animate-in fade-in-0 zoom-in-95",
            )}
          >
            <RadixDialog.Title className="font-display text-base font-semibold text-[var(--color-text-primary)]">
              Leave group?
            </RadixDialog.Title>
            <RadixDialog.Description className="text-sm text-[var(--color-text-secondary)] mt-2">
              You&apos;ll no longer see this group&apos;s activity or messages.
              You&apos;ll need a new invite to rejoin.
            </RadixDialog.Description>
            <div className="flex gap-3 mt-5">
              <RadixDialog.Close asChild>
                <Button variant="secondary" className="flex-1">
                  Cancel
                </Button>
              </RadixDialog.Close>
              <Button
                variant="primary"
                className="flex-1 !bg-miss hover:!bg-miss/90"
                onClick={handleLeaveGroup}
                loading={isLeaving}
              >
                Leave
              </Button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      {reportTarget && (
        <ReportSheet
          open={!!reportTarget}
          onOpenChange={(open) => {
            if (!open) setReportTarget(null);
          }}
          contentType={reportTarget.contentType}
          contentId={reportTarget.contentId}
        />
      )}

      {ToastElements}
    </div>
  );
}
