"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Returns true if the user has any feed with unread activity.
 * Queries the same tables the feed page uses (through RLS) to stay consistent.
 */
export function useHasUnreadFeeds(userId: string | null) {
  return useQuery({
    queryKey: ["unread-feeds", userId],
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;
      const supabase = createClient();

      // 1. Unread encouragements (same check as feed page)
      const { count: unreadEnc } = await supabase
        .from("encouragements")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .eq("is_read", false);

      if (unreadEnc && unreadEnc > 0) return true;

      // 2. Unread group messages (messages from others newer than cursor)
      const { data: memberships } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId);

      if (!memberships || memberships.length === 0) return false;

      const groupIds = memberships.map((m) => m.group_id);

      const { data: cursors } = await supabase
        .from("feed_read_cursors")
        .select("feed_id, last_read_at")
        .eq("user_id", userId)
        .eq("feed_type", "group");

      const cursorMap = new Map<string, string>();
      for (const c of cursors ?? []) {
        cursorMap.set(c.feed_id, c.last_read_at);
      }

      // Check each group for messages from others after cursor
      for (const gid of groupIds) {
        const cursor = cursorMap.get(gid);
        let query = supabase
          .from("group_messages")
          .select("*", { count: "exact", head: true })
          .eq("group_id", gid)
          .neq("user_id", userId);

        if (cursor) {
          query = query.gt("created_at", cursor);
        }

        const { count } = await query;
        if (count && count > 0) return true;
      }

      return false;
    },
  });
}
