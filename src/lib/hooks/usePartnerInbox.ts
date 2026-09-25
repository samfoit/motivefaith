"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import {
  toPartnerInboxItem,
  type PartnerInboxItem,
  type PartnerInboxRpcRow,
} from "@/lib/types/partners";

export const PARTNER_INBOX_KEY = ["partner-inbox"];

export function partnerInboxKey(userId: string | null) {
  return [...PARTNER_INBOX_KEY, userId];
}

/**
 * Partnership invitations and requests waiting on this user.
 *
 * One query serves both the inbox page and the TopBar badge — the badge is
 * just `.length`, so it costs no extra round trip.
 */
export function usePartnerInbox(
  userId: string | null,
  options?: { initialData?: PartnerInboxItem[] },
) {
  return useQuery({
    queryKey: partnerInboxKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    initialData: options?.initialData,
    queryFn: async (): Promise<PartnerInboxItem[]> => {
      if (!userId) return [];
      const supabase = createClient();
      const { data, error } = await untypedRpc<PartnerInboxRpcRow[]>(
        supabase,
        "get_partner_inbox",
      );

      if (error) {
        console.error("get_partner_inbox error:", error.message);
        return [];
      }

      return (data ?? []).map(toPartnerInboxItem);
    },
  });
}
