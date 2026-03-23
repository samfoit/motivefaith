import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { FeedClient } from "./feed-client";
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

    friendRows.push({
      friend: profile,
      sharedHabits: row.shared_habits ?? [],
      latestActivity,
      previewText,
      hasNewActivity: false,
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
// Page
// --------------------------------------------------------------------------

export default async function FeedPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const rpcCall = supabase.rpc("get_feed_friends", { p_user_id: user.id });
  const [{ data: rpcRows }, { data: myGroupMemberships }] = await Promise.all([
    rpcCall,
    supabase
      .from("group_members")
      .select("group_id, role")
      .eq("user_id", user.id),
  ]);

  const friendRows = buildFriendRows(
    (rpcRows ?? []) as unknown as FeedFriendRow[],
    user.id,
  );

  // Stream: render friends immediately, groups load in Suspense boundary
  return (
    <Suspense fallback={<FeedClient userId={user.id} friends={friendRows} />}>
      <FeedWithGroups
        userId={user.id}
        friendRows={friendRows}
        memberships={myGroupMemberships ?? []}
      />
    </Suspense>
  );
}

/** Async component that fetches group details — rendered inside Suspense. */
async function FeedWithGroups({
  userId,
  friendRows,
  memberships,
}: {
  userId: string;
  friendRows: FriendFeedRow[];
  memberships: { group_id: string; role: string | null }[];
}) {
  if (memberships.length === 0) {
    return <FeedClient userId={userId} friends={friendRows} />;
  }

  const supabase = await createServerSupabase();
  const groupIds = memberships.map((m) => m.group_id);
  const roleMap = new Map(
    memberships.map((m) => [m.group_id, m.role as "admin" | "member"]),
  );

  const [{ data: groups }, { data: latestMessages }] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, avatar_url, group_members(count)")
      .in("id", groupIds),
    supabase
      .from("group_messages")
      .select("group_id, content, user_id, created_at, profiles!user_id(display_name)")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      // We only use the latest message per group for the feed preview.
      // Limit to 2× group count to account for groups where the latest
      // row might get filtered by RLS, while avoiding unbounded fetches.
      .limit(Math.max(groupIds.length * 2, 10)),
  ]);

  const memberCountMap = new Map<string, number>();
  for (const g of groups ?? []) {
    const countArr = g.group_members as unknown as { count: number }[];
    memberCountMap.set(g.id, countArr?.[0]?.count ?? 0);
  }

  const latestMsgMap = new Map<
    string,
    { content: string; user_id: string; created_at: string; author_name: string | null }
  >();
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
  }

  const groupRows: GroupFeedRow[] = [];
  for (const g of groups ?? []) {
    const latestMsg = latestMsgMap.get(g.id);
    let previewText = "No messages yet";
    let latestActivity: string | null = null;

    if (latestMsg) {
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

    groupRows.push({
      group: { id: g.id, name: g.name, avatar_url: g.avatar_url },
      memberCount: memberCountMap.get(g.id) ?? 0,
      previewText,
      latestActivity,
      hasNewActivity: false,
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
