"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Users, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FriendRow } from "@/components/social/FriendRow";
import { GroupRow } from "@/components/social/GroupRow";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import type { FriendFeedRow } from "@/lib/types/feed";
import type { GroupFeedRow } from "@/lib/types/groups";

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

/** Max stagger delay per item (ms). Total capped at 1.5s. */
function staggerDelay(index: number, total: number): string {
  const perItem = total > 0 ? Math.min(60, 1500 / total) : 60;
  return `${index * perItem}ms`;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type FilterTab = "all" | "friends" | "groups";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FeedClientProps {
  userId: string;
  friends: FriendFeedRow[];
  groups?: GroupFeedRow[];
}

export function FeedClient({ userId, friends, groups = [] }: FeedClientProps) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const [filter, setFilter] = useState<FilterTab>("all");

  const refresh = useCallback(() => {
    // Debounce: skip if refreshed within the last 2s
    if (Date.now() - lastRefresh.current < 2000) return;
    lastRefresh.current = Date.now();
    router.refresh();
  }, [router]);

  // Derive stable ID lists for realtime filters
  const friendIds = useMemo(
    () => friends.map((f) => f.friend.id),
    [friends],
  );
  const groupIds = useMemo(
    () => groups.map((g) => g.group.id),
    [groups],
  );

  // Realtime: refresh on new activity relevant to the feed.
  // Filters scoped to this user's friends/groups to avoid receiving
  // system-wide events (previously caused spurious refreshes at scale).
  useEffect(() => {
    const supabase = createClient();

    let channel = supabase.channel("feed-realtime");

    // Completions from friends only (skip if no friends — nothing to listen for)
    if (friendIds.length > 0) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "completions",
          filter: `user_id=in.(${friendIds.join(",")})`,
        },
        refresh,
      );
    }

    // Encouragements directed at me
    channel = channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "encouragements",
        filter: `recipient_id=eq.${userId}`,
      },
      refresh,
    );

    // New friend requests addressed to me
    channel = channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "friendships",
        filter: `addressee_id=eq.${userId}`,
      },
      refresh,
    );

    // Acceptance of my outgoing friend requests
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "friendships",
        filter: `register_id=eq.${userId}`,
      },
      refresh,
    );

    // Group messages in my groups only
    if (groupIds.length > 0) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_messages",
          filter: `group_id=in.(${groupIds.join(",")})`,
        },
        refresh,
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh, userId, friendIds, groupIds]);

  // Refresh on tab/window focus to catch changes while backgrounded.
  // No immediate refresh on mount — the server-rendered data is fresh and
  // realtime subscriptions handle subsequent updates.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Interleaved list for "All" filter — sorted by latest activity
  const allItems = useMemo(() => {
    const items: { type: "friend" | "group"; key: string; latestActivity: string | null; data: FriendFeedRow | GroupFeedRow }[] = [];

    for (const f of friends) {
      items.push({
        type: "friend",
        key: `f-${f.friend.id}`,
        latestActivity: f.latestActivity,
        data: f,
      });
    }

    for (const g of groups) {
      items.push({
        type: "group",
        key: `g-${g.group.id}`,
        latestActivity: g.latestActivity,
        data: g,
      });
    }

    items.sort((a, b) => {
      if (!a.latestActivity && !b.latestActivity) return 0;
      if (!a.latestActivity) return 1;
      if (!b.latestActivity) return -1;
      return new Date(b.latestActivity).getTime() - new Date(a.latestActivity).getTime();
    });

    return items;
  }, [friends, groups]);

  const hasGroups = groups.length > 0;
  const isEmpty = friends.length === 0 && groups.length === 0;

  const visibleCount =
    filter === "all"
      ? allItems.length
      : filter === "friends"
        ? friends.length
        : groups.length;

  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1
            className="font-display font-bold text-[var(--color-text-primary)]"
            style={{ fontSize: "var(--text-2xl)" }}
          >
            Feed
          </h1>
          <Link
            href="/main/feed/new-group"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Group</span>
          </Link>
        </div>

        {/* Filter tabs (only show if user has both friends and groups) */}
        {hasGroups && friends.length > 0 && (
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary)]">
            {(["all", "friends", "groups"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={cn(
                  "flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize",
                  filter === tab
                    ? "bg-brand text-white"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {!isEmpty ? (
          <div key={filter} className="space-y-2">
            {filter === "all" &&
              allItems.map((item, i) => (
                <div
                  key={item.key}
                  className="animate-[landing-fade-up-sm_0.3s_var(--ease-out)_both]"
                  style={{ animationDelay: staggerDelay(i, visibleCount) }}
                >
                  {item.type === "friend" ? (
                    <FriendRow row={item.data as FriendFeedRow} />
                  ) : (
                    <GroupRow row={item.data as GroupFeedRow} />
                  )}
                </div>
              ))}

            {filter === "friends" &&
              friends.map((row, i) => (
                <div
                  key={row.friend.id}
                  className="animate-[landing-fade-up-sm_0.3s_var(--ease-out)_both]"
                  style={{ animationDelay: staggerDelay(i, visibleCount) }}
                >
                  <FriendRow row={row} />
                </div>
              ))}

            {filter === "groups" &&
              groups.map((row, i) => (
                <div
                  key={row.group.id}
                  className="animate-[landing-fade-up-sm_0.3s_var(--ease-out)_both]"
                  style={{ animationDelay: staggerDelay(i, visibleCount) }}
                >
                  <GroupRow row={row} />
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center mx-auto mb-4">
              <Users className="w-6 h-6 text-[var(--color-text-tertiary)]" />
            </div>
            <h2
              className="font-display font-semibold text-[var(--color-text-primary)] mb-2"
              style={{ fontSize: "var(--text-xl)" }}
            >
              No friends yet
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-xs mx-auto">
              Add friends and share habits with them to see their activity here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
