import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { FeedClient } from "./feed-client";
import { Skeleton } from "@/components/ui/Skeleton";
import type { FriendFeedRow } from "@/lib/types/feed";
import type { GroupFeedRow } from "@/lib/types/groups";

// --------------------------------------------------------------------------
// Types for the RPC result
// --------------------------------------------------------------------------

interface FeedFriendRow {
  friend_id: string;
  display_name: string;
  avatar_url: string | null;
  username: string;
  friendship_since: string | null;
  shared_habits: { emoji: string; title: string }[];
  latest_completion: {
    habit_id: string;
    user_id: string;
    completion_type: string;
    notes: string | null;
    completed_at: string;
    habit_emoji: string;
    habit_title: string;
  } | null;
  latest_encouragement: {
    encouragement_type: string;
    content: string | null;
    created_at: string;
    user_id: string;
  } | null;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function buildFriendRows(
  rows: FeedFriendRow[],
  userId: string,
  unreadFriendIds: Set<string>,
): FriendFeedRow[] {
  const friendRows: FriendFeedRow[] = [];

  for (const row of rows) {
    const profile = {
      id: row.friend_id,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      username: row.username,
    };

    const comp = row.latest_completion;
    const enc = row.latest_encouragement;

    const compTime = comp ? new Date(comp.completed_at).getTime() : 0;
    const encTime = enc ? new Date(enc.created_at).getTime() : 0;

    let previewText = "No shared activity yet";
    let latestActivity: string | null = null;

    if (compTime >= encTime && comp) {
      const isMe = comp.user_id === userId;
      const actor = isMe ? "You" : profile.display_name.split(" ")[0];
      previewText = `${actor} completed ${comp.habit_emoji} ${comp.habit_title}`;
      latestActivity = comp.completed_at;
    } else if (enc) {
      const isMe = enc.user_id === userId;
      const actor = isMe ? "You" : profile.display_name.split(" ")[0];
      if (enc.encouragement_type === "emoji") {
        previewText = `${actor} sent ${enc.content ?? "an emoji"}`;
      } else if (enc.encouragement_type === "nudge") {
        previewText = isMe
          ? `You nudged ${profile.display_name.split(" ")[0]}`
          : `${profile.display_name.split(" ")[0]} nudged you`;
      } else if (enc.encouragement_type === "message") {
        const msg = enc.content
          ? enc.content.length > 30
            ? enc.content.slice(0, 30) + "\u2026"
            : enc.content
          : "";
        previewText = `${actor}: "${msg}"`;
      } else {
        previewText = `${actor} sent encouragement`;
      }
      latestActivity = enc.created_at;
    }

    const hasNew = unreadFriendIds.has(row.friend_id);

    friendRows.push({
      friend: profile,
      sharedHabits: row.shared_habits ?? [],
      latestActivity,
      previewText,
      hasNewActivity: hasNew,
      friendshipSince: row.friendship_since ?? "",
    });
  }

  friendRows.sort((a, b) => {
    if (!a.latestActivity && !b.latestActivity) return 0;
    if (!a.latestActivity) return 1;
    if (!b.latestActivity) return -1;
    return (
      new Date(b.latestActivity).getTime() -
      new Date(a.latestActivity).getTime()
    );
  });

  return friendRows;
}

// --------------------------------------------------------------------------
// Skeletons
// --------------------------------------------------------------------------

function FeedSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        <Skeleton variant="text" width={80} height={32} />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 shadow-sm">
              <Skeleton variant="circle" width={48} height={48} />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton variant="text" width="45%" height={16} />
                <Skeleton variant="text" width="65%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page — shell renders immediately, data streams via Suspense
// --------------------------------------------------------------------------

export default async function FeedPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  return (
    <Suspense fallback={<FeedSkeleton />}>
      <FeedData userId={user.id} />
    </Suspense>
  );
}

/** Async component — fetches friends, then streams groups via nested Suspense. */
async function FeedData({ userId }: { userId: string }) {
  const supabase = await createServerSupabase();

  const [
    { data: rpcRows },
    { data: myGroupMemberships },
    { data: cursors },
    { data: unreadEnc },
  ] = await Promise.all([
    supabase.rpc("get_feed_friends", { p_user_id: userId }),
    supabase
      .from("group_members")
      .select("group_id, role")
      .eq("user_id", userId),
    supabase
      .from("feed_read_cursors")
      .select("feed_type, feed_id, last_read_at")
      .eq("user_id", userId),
    supabase
      .from("encouragements")
      .select("user_id")
      .eq("recipient_id", userId)
      .eq("is_read", false),
  ]);

  const cursorMap = new Map<string, string>();
  for (const c of cursors ?? []) {
    cursorMap.set(`${c.feed_type}:${c.feed_id}`, c.last_read_at);
  }

  const unreadFriendIds = new Set<string>();
  for (const e of unreadEnc ?? []) {
    unreadFriendIds.add(e.user_id);
  }

  const friendRows = buildFriendRows(
    (rpcRows ?? []) as unknown as FeedFriendRow[],
    userId,
    unreadFriendIds,
  );

  // Stream: render friends immediately, groups load in nested Suspense
  return (
    <Suspense fallback={<FeedClient userId={userId} friends={friendRows} />}>
      <FeedWithGroups
        userId={userId}
        friendRows={friendRows}
        memberships={myGroupMemberships ?? []}
        cursorMap={cursorMap}
      />
    </Suspense>
  );
}

/** Async component that fetches group details — rendered inside nested Suspense. */
async function FeedWithGroups({
  userId,
  friendRows,
  memberships,
  cursorMap,
}: {
  userId: string;
  friendRows: FriendFeedRow[];
  memberships: { group_id: string; role: string | null }[];
  cursorMap: Map<string, string>;
}) {
  if (memberships.length === 0) {
    return <FeedClient userId={userId} friends={friendRows} />;
  }

  const supabase = await createServerSupabase();
  const groupIds = memberships.map((m) => m.group_id);
  const roleMap = new Map(
    memberships.map((m) => [m.group_id, m.role as "admin" | "member"]),
  );

  const [{ data: groups }, { data: latestMessages }, { data: habitShares }] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, avatar_url, group_members(count)")
      .in("id", groupIds),
    supabase
      .from("group_messages")
      .select("group_id, content, user_id, created_at, profiles!user_id(display_name)")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(groupIds.length * 2, 10)),
    supabase
      .from("group_habit_shares")
      .select("group_id, habit_id")
      .in("group_id", groupIds),
  ]);

  // Build habit_id → group_id(s) mapping and fetch latest completions
  const habitToGroups = new Map<string, string[]>();
  for (const share of habitShares ?? []) {
    const existing = habitToGroups.get(share.habit_id);
    if (existing) existing.push(share.group_id);
    else habitToGroups.set(share.habit_id, [share.group_id]);
  }

  const sharedHabitIds = [...habitToGroups.keys()];
  const latestCompMap = new Map<
    string,
    { user_id: string; completed_at: string; habit_emoji: string; habit_title: string; user_name: string }
  >();

  if (sharedHabitIds.length > 0) {
    const { data: latestCompletions } = await supabase
      .from("completions")
      .select("habit_id, user_id, completed_at, habits!inner(emoji, title), profiles!user_id(display_name)")
      .in("habit_id", sharedHabitIds)
      .order("completed_at", { ascending: false })
      .limit(Math.max(groupIds.length * 2, 10));

    for (const comp of latestCompletions ?? []) {
      if (!comp.completed_at) continue;
      const gids = habitToGroups.get(comp.habit_id);
      if (!gids) continue;
      const habit = comp.habits as unknown as { emoji: string; title: string };
      const profile = comp.profiles as unknown as { display_name: string } | null;
      const entry = {
        user_id: comp.user_id,
        completed_at: comp.completed_at,
        habit_emoji: habit?.emoji ?? "✅",
        habit_title: habit?.title ?? "habit",
        user_name: profile?.display_name ?? "Someone",
      };
      for (const gid of gids) {
        if (!latestCompMap.has(gid)) latestCompMap.set(gid, entry);
      }
    }
  }

  const memberCountMap = new Map<string, number>();
  for (const g of groups ?? []) {
    const countArr = g.group_members as unknown as { count: number }[];
    memberCountMap.set(g.id, countArr?.[0]?.count ?? 0);
  }

  const latestMsgMap = new Map<
    string,
    { content: string; user_id: string; created_at: string; author_name: string | null }
  >();
  const latestOtherMsgMap = new Map<string, string>();
  for (const msg of latestMessages ?? []) {
    if (!latestMsgMap.has(msg.group_id) && msg.created_at) {
      const profile = msg.profiles as unknown as { display_name: string } | null;
      latestMsgMap.set(msg.group_id, {
        content: msg.content,
        user_id: msg.user_id,
        created_at: msg.created_at,
        author_name: profile?.display_name ?? null,
      });
    }
    if (!latestOtherMsgMap.has(msg.group_id) && msg.created_at && msg.user_id !== userId) {
      latestOtherMsgMap.set(msg.group_id, msg.created_at);
    }
  }

  const groupRows: GroupFeedRow[] = [];
  for (const g of groups ?? []) {
    const latestMsg = latestMsgMap.get(g.id);
    const latestComp = latestCompMap.get(g.id);
    let previewText = "No activity yet";
    let latestActivity: string | null = null;

    const msgTime = latestMsg ? new Date(latestMsg.created_at).getTime() : 0;
    const compTime = latestComp ? new Date(latestComp.completed_at).getTime() : 0;

    if (compTime > msgTime && latestComp) {
      const actor =
        latestComp.user_id === userId
          ? "You"
          : latestComp.user_name.split(" ")[0];
      previewText = `${actor} completed ${latestComp.habit_emoji} ${latestComp.habit_title}`;
      latestActivity = latestComp.completed_at;
    } else if (latestMsg) {
      const authorName =
        latestMsg.user_id === userId
          ? "You"
          : latestMsg.author_name?.split(" ")[0] ?? "Someone";
      const msgPreview =
        latestMsg.content.length > 30
          ? latestMsg.content.slice(0, 30) + "\u2026"
          : latestMsg.content;
      previewText = `${authorName}: "${msgPreview}"`;
      latestActivity = latestMsg.created_at;
    }

    const latestOtherMsg = latestOtherMsgMap.get(g.id) ?? null;
    const latestOtherComp = latestComp && latestComp.user_id !== userId ? latestComp.completed_at : null;
    const latestOther = [latestOtherMsg, latestOtherComp]
      .filter(Boolean)
      .sort()
      .pop() ?? null;
    const cursor = cursorMap.get(`group:${g.id}`);
    const hasNew =
      !!latestOther &&
      (!cursor || new Date(latestOther).getTime() > new Date(cursor).getTime());

    groupRows.push({
      group: { id: g.id, name: g.name, avatar_url: g.avatar_url },
      memberCount: memberCountMap.get(g.id) ?? 0,
      previewText,
      latestActivity,
      hasNewActivity: hasNew,
      myRole: roleMap.get(g.id) ?? "member",
    });
  }

  groupRows.sort((a, b) => {
    if (!a.latestActivity && !b.latestActivity) return 0;
    if (!a.latestActivity) return 1;
    if (!b.latestActivity) return -1;
    return (
      new Date(b.latestActivity).getTime() -
      new Date(a.latestActivity).getTime()
    );
  });

  return <FeedClient userId={userId} friends={friendRows} groups={groupRows} />;
}
