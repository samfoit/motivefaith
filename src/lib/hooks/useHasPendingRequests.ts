"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useHasPendingRequests(userId: string | null) {
  return useQuery({
    queryKey: ["pending-requests", userId],
    enabled: !!userId,
    staleTime: 60_000, // 1 minute
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;
      const supabase = createClient();

      const { count, error } = await supabase
        .from("friendships")
        .select("*", { count: "exact", head: true })
        .eq("addressee_id", userId)
        .eq("status", "pending");

      if (error) {
        console.error("pending requests count error:", error);
        return false;
      }

      return (count ?? 0) > 0;
    },
  });
}
