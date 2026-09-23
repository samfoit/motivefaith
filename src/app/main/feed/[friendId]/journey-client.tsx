"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ArrowLeft, Send, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { SharedHabits } from "@/components/social/SharedHabits";
import { FriendProfileSheet } from "@/components/social/FriendProfileSheet";
import { JourneyTimeline } from "@/components/social/JourneyTimeline";
import { createClient } from "@/lib/supabase/client";
import { sendOrQueue } from "@/lib/offline-write";
import { useReadFeedsStore } from "@/lib/stores/read-feeds-store";
import { useKeyboardOffset } from "@/lib/hooks/useKeyboardOffset";
import { useScrollToLatest } from "@/lib/hooks/useScrollToLatest";
import type { JourneyData, JourneyEncouragement } from "@/lib/types/feed";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface JourneyClientProps {
  data: JourneyData;
  userId: string;
}

export function JourneyClient({ data, userId }: JourneyClientProps) {
  // Their habits live behind a tap on their name, not inline above the thread.
  const [profileOpen, setProfileOpen] = useState(false);
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

  const { friend, friendshipSince, habits, completions } = data;

  // Pending entries: optimistic sends + realtime arrivals not yet in server data
  const [pendingEntries, setPendingEntries] = useState<JourneyEncouragement[]>(
    [],
  );

  // Derive the merged list — server data is the source of truth,
  // pending entries fill the gap until the next server refresh
  const mergedEncouragements = useMemo(() => {
    const serverIds = new Set(data.encouragements.map((e) => e.id));
    const unconfirmed = pendingEntries.filter((e) => !serverIds.has(e.id));
    return [...data.encouragements, ...unconfirmed];
  }, [data.encouragements, pendingEntries]);

  // Debounced refresh — avoids hammering the server on rapid realtime events
  const lastRefresh = useRef(0);
  const debouncedRefresh = useCallback(() => {
    if (Date.now() - lastRefresh.current < 2000) return;
    lastRefresh.current = Date.now();
    router.refresh();
  }, [router]);

  const friendFirstName = friend.display_name.split(" ")[0];

  // Realtime subscriptions
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`journey-${friend.id}`)
      // Completions: only listen for the friend's new completions
      // (our own are handled by the completion flow already)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "completions",
          filter: `user_id=eq.${friend.id}`,
        },
        () => debouncedRefresh(),
      )
      // Encouragements: only listen for messages sent TO the current user
      // (our outgoing messages are handled optimistically)
      .on<{
        id: string;
        user_id: string;
        recipient_id: string;
        encouragement_type: "nudge" | "message" | "emoji" | "voice";
        content: string | null;
        created_at: string;
      }>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "encouragements",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new;
          // Filter further: only this friend (not other friends' messages)
          if (row.user_id !== friend.id) return;

          const newEnc: JourneyEncouragement = {
            id: row.id,
            encouragement_type: row.encouragement_type,
            content: row.content,
            created_at: row.created_at,
            user_id: row.user_id,
            isMe: false,
            sender_name: friend.display_name,
          };

          setPendingEntries((prev) => {
            if (prev.some((e) => e.id === newEnc.id)) return prev;
            return [...prev, newEnc];
          });

          setTimeout(() => scrollToLatest("smooth"), 50);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [friend.id, friend.display_name, userId, debouncedRefresh, scrollToLatest]);

  // Refresh stale data on tab focus / visibility change
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

  // Mark all messages from this friend as read
  const markFeedRead = useReadFeedsStore((s) => s.markRead);
  useEffect(() => {
    markFeedRead(friend.id);
    const supabase = createClient();
    supabase
      .from("encouragements")
      .update({ is_read: true })
      .eq("recipient_id", userId)
      .eq("user_id", friend.id)
      .eq("is_read", false)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["unread-feeds"] });
      });
  }, [friend.id, userId, queryClient, markFeedRead]);

  const sendMessage = useCallback(async () => {
    const text = message.trim();
    if (!text || isSending) return;

    // Optimistic insert
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticEnc: JourneyEncouragement = {
      id: optimisticId,
      encouragement_type: "message",
      content: text,
      created_at: new Date().toISOString(),
      user_id: userId,
      isMe: true,
      sender_name: "You",
    };
    setPendingEntries((prev) => [...prev, optimisticEnc]);
    setMessage("");
    inputRef.current?.focus();

    // Scroll to the new message
    setTimeout(() => scrollToLatest("smooth"), 50);

    setIsSending(true);
    const supabase = createClient();

    const { data: inserted, error } = await supabase
      .from("encouragements")
      .insert({
        user_id: userId,
        recipient_id: friend.id,
        encouragement_type: "message",
        content: text,
      })
      .select("id")
      .single();

    setIsSending(false);

    if (error) {
      // Remove the optimistic entry on failure
      setPendingEntries((prev) => prev.filter((e) => e.id !== optimisticId));
      setMessage(text);
      showToast({
        variant: "error",
        title: "Failed to send",
        description: "Try again",
      });
      return;
    }

    // Replace optimistic id with real id so realtime deduplication works
    if (inserted) {
      setPendingEntries((prev) =>
        prev.map((e) =>
          e.id === optimisticId ? { ...e, id: inserted.id } : e,
        ),
      );
    }

    // Refresh server data for eventual consistency
    debouncedRefresh();
  }, [message, isSending, userId, friend.id, showToast, debouncedRefresh, scrollToLatest]);

  const handleHeartCompletion = useCallback(async (completionId: string, isHearted: boolean) => {
    const supabase = createClient();

    if (isHearted) {
      // Remove heart — find the matching pending/server entry and delete it
      const existing = mergedEncouragements.find(
        (e) =>
          e.completion_id === completionId &&
          e.isMe &&
          e.encouragement_type === "emoji" &&
          e.content === "❤️",
      );

      if (existing) {
        setPendingEntries((prev) => prev.filter((e) => e.id !== existing.id));
      }

      try {
        const result = await sendOrQueue(
          {
            id: crypto.randomUUID(),
            kind: "encouragement.delete",
            userId,
            // Queue by id where we know it. An optimistic entry that was never
            // sent has no server row to delete — its own queued create is
            // still in the outbox and will be dropped there instead.
            payload: { encouragementId: existing?.id ?? "" },
          },
          async () => {
            const { error } = await supabase
              .from("encouragements")
              .delete()
              .eq("user_id", userId)
              .eq("completion_id", completionId)
              .eq("encouragement_type", "emoji")
              .eq("content", "❤️");
            if (error) throw error;
            return { queued: false as const };
          },
        );
        if (!("queued" in result && result.queued)) debouncedRefresh();
      } catch {
        // Restore on failure
        if (existing) {
          setPendingEntries((prev) => [...prev, existing]);
        }
        showToast({ variant: "error", title: "Failed to remove reaction" });
      }
      return;
    }

    // Add heart.
    //
    // The id is minted here rather than by Postgres: `encouragements.id` is
    // `uuid DEFAULT gen_random_uuid()` and the RLS policy constrains
    // `user_id`, so the client may choose it. That makes a queued reaction
    // idempotent on replay, and means the optimistic entry already carries its
    // final id — no swap from a temporary one when the insert returns.
    const optimisticId = crypto.randomUUID();
    setPendingEntries((prev) => [
      ...prev,
      {
        id: optimisticId,
        encouragement_type: "emoji",
        content: "❤️",
        created_at: new Date().toISOString(),
        user_id: userId,
        isMe: true,
        sender_name: "You",
        completion_id: completionId,
      },
    ]);

    const heartRow = {
      id: optimisticId,
      user_id: userId,
      recipient_id: friend.id,
      encouragement_type: "emoji" as const,
      content: "❤️",
      completion_id: completionId,
    };

    try {
      await sendOrQueue(
        {
          id: optimisticId,
          kind: "encouragement.create",
          userId,
          payload: {
            recipient_id: friend.id,
            encouragement_type: "emoji",
            content: "❤️",
            completion_id: completionId,
          },
        },
        async () => {
          const { error } = await supabase.from("encouragements").insert(heartRow);
          if (error) throw error;
          return { queued: false as const };
        },
      );
    } catch {
      setPendingEntries((prev) => prev.filter((e) => e.id !== optimisticId));
      showToast({
        variant: "error",
        title: "Failed to react",
        description: "Try again",
      });
      return;
    }

    // No id swap: the optimistic entry was created with the row's real id, so
    // there is no temporary one to replace once the insert lands.
    debouncedRefresh();
  }, [userId, friend.id, mergedEncouragements, showToast, debouncedRefresh]);

  return (
    <div>
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-32 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </button>
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex min-w-0 items-center gap-3 text-left rounded-lg transition-opacity active:opacity-70"
            aria-label={`View ${friend.display_name}'s habits`}
          >
            <Avatar
              src={friend.avatar_url}
              name={friend.display_name}
              size="sm"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1">
                <span className="font-display font-bold text-text-primary text-base truncate">
                  {friend.display_name}
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-text-tertiary" />
              </span>
              <Pill size="sm" variant="default">
                Friends{" "}
                {formatDistanceToNow(new Date(friendshipSince), {
                  addSuffix: false,
                })}
              </Pill>
            </span>
          </button>
        </div>

        {/* Shared habits — one line of chips, details in a sheet */}
        <SharedHabits habits={habits} friendName={friendFirstName} />

        {/* Timeline */}
        <section>
          <JourneyTimeline
            completions={completions}
            encouragements={mergedEncouragements}
            friendName={friendFirstName}
            onHeartCompletion={handleHeartCompletion}
          />
        </section>
      </div>

      {/* Bottom message input */}
      <div
        ref={inputBarRef}
        className="fixed inset-x-0 z-30 bg-bg-primary border-t border-bg-secondary"
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
            placeholder={`Message ${friendFirstName}...`}
            maxLength={300}
            className={cn(
              "flex-1 min-w-0 rounded-full px-4 py-2.5 text-base",
              "bg-bg-secondary text-text-primary",
              "placeholder:text-text-tertiary",
              "focus:outline-none focus:ring-2 focus:ring-brand/40",
              "transition-shadow",
            )}
          />
          <button
            type="submit"
            disabled={!message.trim() || isSending}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
              "transition-all",
              message.trim()
                ? "bg-brand text-white active:scale-95"
                : "bg-bg-secondary text-text-tertiary",
            )}
            aria-label="Send message"
          >
            <Send className="w-4.5 h-4.5" />
          </button>
        </form>
      </div>

      <FriendProfileSheet
        friend={friend}
        open={profileOpen}
        onOpenChange={setProfileOpen}
        onChanged={() => router.refresh()}
      />
      {ToastElements}
    </div>
  );
}
