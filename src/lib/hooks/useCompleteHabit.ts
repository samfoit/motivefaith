"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queueCompletion } from "@/lib/offline-queue";

interface CompleteHabitParams {
  habitId: string;
  type: "photo" | "video" | "message" | "quick";
  evidenceUrl?: string;
  notes?: string;
}

export function useCompleteHabit() {
  const supabase = createClient();

  return useMutation({
    mutationFn: async (params: CompleteHabitParams) => {
      // If offline, queue for Background Sync
      if (!navigator.onLine) {
        await queueCompletion({
          habitId: params.habitId,
          type: params.type,
          evidenceUrl: params.evidenceUrl,
          notes: params.notes,
        });
        return { queued: true } as const;
      }

      // The RPC runs as the authenticated user (auth.uid()) — no need for
      // an extra getUser() round-trip. If the session is missing, the RPC
      // will return a permission error via RLS.
      const { data, error } = await supabase.rpc("insert_completion", {
        p_habit_id: params.habitId,
        p_completion_type: params.type,
        p_evidence_url: params.evidenceUrl,
        p_notes: params.notes,
      });

      if (error) throw error;
      return data;
    },
  });
}
