"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import { PARTNER_INBOX_KEY } from "@/lib/hooks/usePartnerInbox";

/**
 * Every transition in the partnership state machine lives behind an RPC —
 * habit_shares is not writable from the client, by design. These wrap the four
 * the partner side needs.
 *
 * Postgres raises these with an ERRCODE the RPCs pick deliberately, and the
 * message is written to be shown to a person, so it is surfaced rather than
 * swallowed: "This request was declined recently" is the honest answer to a
 * second ask, and a generic failure toast would leave the user retrying.
 */
function rpcError(error: { message: string } | null): string | null {
  if (!error) return null;
  // Postgres prefixes nothing, but PostgREST can wrap the message.
  return error.message.replace(/^.*?:\s*/, "") || error.message;
}

/** Everything the two partner surfaces read goes stale on any transition. */
function useInvalidatePartnerViews() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: PARTNER_INBOX_KEY });
    queryClient.invalidateQueries({ queryKey: ["profile-habits"] });
  };
}

/** Answer an invitation or a request that is yours to answer. */
export function useRespondToPartner() {
  const invalidate = useInvalidatePartnerViews();

  return useMutation({
    mutationFn: async ({
      shareId,
      accept,
    }: {
      shareId: string;
      accept: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await untypedRpc(supabase, "respond_habit_partner", {
        p_share_id: shareId,
        p_accept: accept,
      });
      if (error) throw new Error(rpcError(error) ?? "Failed to answer");
    },
    onSettled: invalidate,
  });
}

/** Ask to follow a friend's public habit. */
export function useRequestPartner() {
  const invalidate = useInvalidatePartnerViews();

  return useMutation({
    mutationFn: async (habitId: string) => {
      const supabase = createClient();
      const { error } = await untypedRpc(supabase, "request_habit_partner", {
        p_habit_id: habitId,
      });
      if (error) throw new Error(rpcError(error) ?? "Failed to send request");
    },
    onSettled: invalidate,
  });
}

/** Withdraw a request, or leave a partnership. */
export function useCancelPartner() {
  const invalidate = useInvalidatePartnerViews();

  return useMutation({
    mutationFn: async (shareId: string) => {
      const supabase = createClient();
      const { error } = await untypedRpc(supabase, "cancel_habit_partner", {
        p_share_id: shareId,
      });
      if (error) throw new Error(rpcError(error) ?? "Failed to cancel");
    },
    onSettled: invalidate,
  });
}
