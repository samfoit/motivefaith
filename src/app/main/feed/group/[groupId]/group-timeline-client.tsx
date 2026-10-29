"use client";

import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  Copy,
  Flag,
  Heart,
  Send,
  Camera,
  ChevronRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { FEED_WINDOW_MS } from "@/lib/constants/limits";
import { TopBarActions, TopBarTitle } from "@/components/layout/TopBarSlots";
import {
  TOP_BAR_ICON_BUTTON_CLASS,
  TOP_BAR_SUBTITLE_CLASS,
  TOP_BAR_TITLE_CLASS,
  TOP_BAR_TITLE_STYLE,
} from "@/components/layout/topBarStyles";
import dynamic from "next/dynamic";
import { useToast } from "@/components/ui/Toast";
import { SharedHabits, type SharedHabitChip } from "@/components/social/SharedHabits";
import type { ChallengeFormData } from "@/components/social/CreateChallengeSheet";

const InviteLinkSheet = dynamic(
  () => import("@/components/social/InviteLinkSheet").then((m) => m.InviteLinkSheet),
  { ssr: false },
);
const CreateChallengeSheet = dynamic(
  () => import("@/components/social/CreateChallengeSheet").then((m) => m.CreateChallengeSheet),
  { ssr: false },
);
import { createClient } from "@/lib/supabase/client";
import { useReadFeedsStore } from "@/lib/stores/read-feeds-store";
import { useQuickCaptureStore } from "@/lib/stores/quick-capture-store";
import { useKeyboardOffset } from "@/lib/hooks/useKeyboardOffset";
import { useScrollToLatest } from "@/lib/hooks/useScrollToLatest";
import { useRegenerateInviteCode, useRemoveGroupMember } from "@/lib/hooks/useGroups";
import { useCreateChallenge, useJoinChallenge, useLeaveChallenge } from "@/lib/hooks/useGroupChallenges";
import { ReportSheet } from "@/components/social/ReportSheet";
import { GroupInfoSheet } from "@/components/social/GroupInfoSheet";
import { ChallengeEvent } from "@/components/social/ChallengeEvent";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CompletionBubble } from "@/components/social/CompletionBubble";
import {
  ChatRow,
  MessageBubble,
  TimeDivider,
  layoutRuns,
  type ChatAction,
} from "@/components/social/ChatParts";
import type {
  GroupTimelineData,
  GroupTimelineMessage,
  GroupMessageReaction,
} from "@/lib/types/groups";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** A challenge started or joined, shown in the conversation as it happened. */
type ChallengeEventEntry = {
  kind: "started" | "joined";
  challenge: GroupTimelineData["challenges"][number];
  userId: string;
};

interface GroupTimelineClientProps {
  data: GroupTimelineData;
  userId: string;
}

export function GroupTimelineClient({ data, userId }: GroupTimelineClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show: showToast, ToastElements } = useToast();
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Opens the thread at the newest message and jumps back there on new ones.
  const scrollToLatest = useScrollToLatest();
  const inputBarRef = useRef<HTMLDivElement>(null);
  useKeyboardOffset(inputBarRef, "calc(4rem + env(safe-area-inset-bottom))");

  const { group, members, habits, completions, challenges, myRole } = data;

  // Stable member ID list for realtime filters
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);

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
  const [infoOpen, setInfoOpen] = useState(false);
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
  const [cutoff] = useState(() => Date.now() - FEED_WINDOW_MS);

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

  // The chips scroll, so there is nothing to expand — every shared habit is
  // reachable in the one row.
  const habitChips: SharedHabitChip[] = useMemo(
    () =>
      habits.map((habit) => ({
        id: habit.id,
        title: habit.title,
        emoji: habit.emoji,
        color: habit.color,
        streak_current: habit.streak_current,
        isOwner: habit.owner_id === userId,
        completedToday: habit.completedToday,
        dueToday: habit.dueToday,
        rainCheckedToday: habit.rainCheckedToday,
        rainCheckMovedTo: habit.rainCheckMovedTo,
        ownerName: habit.owner_name,
        ownerAvatar: habit.owner_avatar,
      })),
    [habits, userId],
  );

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
        content: string | null;
        media_path: string | null;
        media_type: "photo" | "video" | "voice" | null;
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
            media_path: row.media_path,
            media_type: row.media_type,
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

          setTimeout(() => scrollToLatest("smooth"), 50);
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
        {
          event: "INSERT",
          schema: "public",
          table: "completions",
          filter: memberIds.length > 0 ? `user_id=in.(${memberIds.join(",")})` : undefined,
        },
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
  }, [group.id, userId, members, memberIds, debouncedRefresh, scrollToLatest]);

  // Challenges started, joined and left show in the conversation as they
  // happen (migration 038 publishes both tables). Its own channel: the
  // participants filter has to follow the list of challenges as it changes.
  const challengeIdsKey = challenges.map((c) => c.id).join(",");
  useEffect(() => {
    const supabase = createClient();
    let channel = supabase.channel(`group-challenges-${group.id}`).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "group_challenges",
        filter: `group_id=eq.${group.id}`,
      },
      () => debouncedRefresh(),
    );
    if (challengeIdsKey) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_challenge_participants",
          filter: `challenge_id=in.(${challengeIdsKey})`,
        },
        () => debouncedRefresh(),
      );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [group.id, challengeIdsKey, debouncedRefresh]);

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

  // Mark this group feed as read
  const markFeedRead = useReadFeedsStore((s) => s.markRead);
  useEffect(() => {
    markFeedRead(group.id);
    const supabase = createClient();
    supabase
      .rpc("upsert_feed_read_cursor", {
        p_feed_type: "group",
        p_feed_id: group.id,
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["unread-feeds"] });
      });
  }, [group.id, queryClient, markFeedRead]);

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

    setTimeout(() => scrollToLatest("smooth"), 50);

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
  }, [message, isSending, userId, group.id, members, showToast, debouncedRefresh, scrollToLatest]);

  // Challenge handlers
  const handleCreateChallenge = async (formData: ChallengeFormData) => {
    await createChallenge.mutateAsync({
      groupId: group.id,
      createdBy: userId,
      title: formData.title,
      emoji: formData.emoji,
      description: formData.description || undefined,
      color: formData.color,
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
        color: challenge.color ?? null,
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

  // Build merged timeline (completions, messages and challenge events,
  // chronological, last 24h)
  const timeline = useMemo(() => {
    const entries: {
      type: "completion" | "message" | "challenge";
      id: string;
      timestamp: string;
      data:
        | GroupTimelineData["completions"][number]
        | GroupTimelineMessage
        | ChallengeEventEntry;
    }[] = [];

    // Who started each challenge and who joined it, from the challenge rows
    // already loaded. The creator is joined automatically when they create
    // it, so their own join would only repeat the "started" line.
    for (const challenge of challenges) {
      if (
        challenge.created_at &&
        new Date(challenge.created_at).getTime() >= cutoff
      ) {
        entries.push({
          type: "challenge",
          id: `challenge-${challenge.id}`,
          timestamp: challenge.created_at,
          data: { kind: "started", challenge, userId: challenge.created_by },
        });
      }
      for (const p of challenge.participants) {
        if (p.user_id === challenge.created_by) continue;
        if (!p.joined_at || new Date(p.joined_at).getTime() < cutoff) continue;
        entries.push({
          type: "challenge",
          id: `joined-${p.id}`,
          timestamp: p.joined_at,
          data: { kind: "joined", challenge, userId: p.user_id },
        });
      }
    }

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
  }, [mergedCompletions, mergedMessages, challenges, cutoff]);

  // Runs of one person's messages, and where a time goes between them.
  const timelineRuns = useMemo(
    () =>
      layoutRuns(
        timeline.map((entry) => ({
          sender:
            entry.type === "challenge"
              ? null
              : (entry.data as { user_id: string }).user_id,
          at: new Date(entry.timestamp).getTime(),
        })),
      ),
    [timeline],
  );

  return (
    <div>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-32 space-y-6">
        {/* The group's name is the TopBar's title. Tapping it opens the
            group's info — members, invite, settings, leave — as in any
            messaging app, so the bar keeps only the camera beside it. */}
        <TopBarTitle>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="flex min-w-0 flex-col items-start text-left rounded-lg transition-opacity active:opacity-70"
            aria-label={`${group.name}: members and group options`}
          >
            <span className="flex max-w-full items-center gap-1">
              <span className={TOP_BAR_TITLE_CLASS} style={TOP_BAR_TITLE_STYLE}>
                {group.name}
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-text-tertiary" />
            </span>
            <span className={TOP_BAR_SUBTITLE_CLASS}>
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </button>
        </TopBarTitle>
        {/* The camera, sending only to this group: no "Send to…" step. */}
        <TopBarActions>
          <button
            type="button"
            onClick={() =>
              useQuickCaptureStore.getState().openTo({
                kind: "group",
                id: group.id,
                name: group.name,
                onSent: debouncedRefresh,
              })
            }
            className={TOP_BAR_ICON_BUTTON_CLASS}
            aria-label={`Send ${group.name} a photo or video`}
          >
            <Camera className="w-5 h-5" />
          </button>
        </TopBarActions>

        {/* Today: which shared habits are done and which are still open.
            The full list and the challenges are in the info sheet behind
            the group's name. */}
        <SharedHabits habits={habitChips} />

        {/* Timeline */}
        <section aria-label="Messages">
          {timeline.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">
              No activity in the last 24 hours.
            </p>
          ) : (
            <div className="overflow-x-clip">
              {timeline.map((entry, i) => {
                const position = timelineRuns[i];

                if (entry.type === "challenge") {
                  const e = entry.data as ChallengeEventEntry;
                  const isMe = e.userId === userId;
                  const actor = members.find((m) => m.user_id === e.userId)?.profile;
                  return (
                    <div key={entry.id}>
                      {position.divider && <TimeDivider label={position.divider} />}
                      <ChallengeEvent
                        kind={e.kind}
                        isMe={isMe}
                        actorName={isMe ? "You" : (actor?.display_name ?? "Someone")}
                        actorAvatar={actor?.avatar_url ?? null}
                        challengeEmoji={e.challenge.emoji}
                        challengeTitle={e.challenge.title}
                        onJoin={
                          e.kind === "started" && !e.challenge.myParticipation
                            ? () => handleJoinChallenge(e.challenge.id)
                            : undefined
                        }
                        joining={joiningChallengeId === e.challenge.id}
                      />
                    </div>
                  );
                }

                if (entry.type === "completion") {
                  const c = entry.data as GroupTimelineData["completions"][number];
                  const cReactions = c.reactions ?? [];
                  const cIHearted = cReactions.some((r) => r.user_id === userId);

                  return (
                    <ChatRow
                      key={entry.id}
                      isMe={c.isMe}
                      position={position}
                      showSender
                      senderName={c.user_name}
                      senderAvatar={c.user_avatar}
                      heartCount={cReactions.length}
                      actionsTitle={`${c.habit_emoji} ${c.habit_title}`}
                      actions={
                        c.isMe
                          ? []
                          : [{
                              label: "Report",
                              icon: Flag,
                              danger: true,
                              onSelect: () =>
                                setReportTarget({ contentType: "completion", contentId: c.id }),
                            }]
                      }
                    >
                      <CompletionBubble
                        isMe={c.isMe}
                        first={position.first}
                        habitEmoji={c.habit_emoji}
                        habitTitle={c.habit_title}
                        habitColor={c.habit_color}
                        completionType={c.completion_type}
                        rainCheckReason={c.rain_check_reason}
                        rainCheckMovedTo={c.rain_check_moved_to}
                        evidenceUrl={c.evidence_url}
                        notes={c.notes}
                        isHearted={cIHearted}
                        onHeart={
                          !c.isMe
                            ? () => toggleCompletionReaction(c.id, cReactions)
                            : undefined
                        }
                      />
                    </ChatRow>
                  );
                }

                // Message
                const m = entry.data as GroupTimelineMessage;
                const reactions = m.reactions ?? [];
                const iHearted = reactions.some((r) => r.user_id === userId);
                const text = m.content;
                // Built in one expression, not pushed: the React Compiler
                // reads a push of a ref-reading handler (toggleReaction ->
                // debouncedRefresh) as a ref access during render.
                const actions: ChatAction[] = [
                  ...(!m.isMe
                    ? [{
                        label: iHearted ? "Remove heart" : "Heart",
                        icon: Heart,
                        onSelect: () => toggleReaction(m.id, reactions),
                      }]
                    : []),
                  ...(text
                    ? [{
                        label: "Copy text",
                        icon: Copy,
                        onSelect: () => {
                          void navigator.clipboard?.writeText(text).then(
                            () => showToast({ variant: "success", title: "Copied" }),
                            () => showToast({ variant: "error", title: "Couldn't copy" }),
                          );
                        },
                      }]
                    : []),
                  ...(!m.isMe
                    ? [{
                        label: "Report",
                        icon: Flag,
                        danger: true,
                        onSelect: () => setReportTarget({ contentType: "message", contentId: m.id }),
                      }]
                    : []),
                ];

                return (
                  <ChatRow
                    key={entry.id}
                    isMe={m.isMe}
                    position={position}
                    showSender
                    senderName={m.user_name}
                    senderAvatar={m.user_avatar}
                    heartCount={reactions.length}
                    actions={actions}
                    actionsTitle={m.isMe ? "Your message" : m.user_name}
                  >
                    <MessageBubble
                      isMe={m.isMe}
                      first={position.first}
                      content={m.content}
                      mediaPath={m.media_path}
                      mediaType={m.media_type}
                    />
                  </ChatRow>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Bottom message input */}
      <div
        ref={inputBarRef}
        className="fixed inset-x-0 z-30 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-secondary)]"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
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
              "bg-elevated ring-1 ring-border text-[var(--color-text-primary)]",
              "placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none focus:ring-2 focus:ring-brand-ink/40",
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
                ? "bg-brand text-on-brand active:scale-95"
                : "bg-elevated ring-1 ring-border text-[var(--color-text-tertiary)]",
            )}
            aria-label="Send message"
          >
            <Send className="w-4.5 h-4.5" />
          </button>
        </form>
      </div>

      {/* Sheets */}
      <GroupInfoSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
        name={group.name}
        members={members}
        userId={userId}
        isAdmin={myRole === "admin"}
        onInvite={() => setInviteOpen(true)}
        onSettings={() => router.push(`/main/feed/group/${group.id}/settings`)}
        onLeave={() => setLeaveConfirmOpen(true)}
        habits={habitChips}
        challenges={challenges}
        onJoinChallenge={handleJoinChallenge}
        onLeaveChallenge={handleLeaveChallenge}
        pendingChallengeId={joiningChallengeId}
        onCreateChallenge={myRole === "admin" ? () => setChallengeSheetOpen(true) : undefined}
      />

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

      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title="Leave group?"
        description="You'll no longer see this group's activity or messages. You'll need a new invite to rejoin."
        confirmLabel="Leave"
        onConfirm={handleLeaveGroup}
        loading={isLeaving}
      />

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
