import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { untypedRpc } from "@/lib/supabase/rpc";
import {
  toLateHabit,
  type LateHabit,
  type LateHabitRpcRow,
} from "@/lib/types/late-habits";

/**
 * The habits someone could use a word about, in one friend's chat, one
 * group's, or with no chat named, every friend's at once: the inbox's list,
 * so each row there has its card in the chat it opens.
 *
 * A suggestion is extra: if the call fails, as on a database without
 * migration 053, the page opens without one rather than not at all.
 */
export async function fetchLateHabits(
  supabase: SupabaseClient<Database>,
  chat?: { friendId: string } | { groupId: string },
): Promise<LateHabit[]> {
  const { data, error } = await untypedRpc<LateHabitRpcRow[]>(
    supabase,
    "get_chat_late_habits",
    !chat ? {} : "friendId" in chat ? { p_friend_id: chat.friendId } : { p_group_id: chat.groupId },
  );
  if (error) {
    console.error("get_chat_late_habits RPC failed:", error.message);
    return [];
  }
  return (data ?? []).map(toLateHabit);
}
