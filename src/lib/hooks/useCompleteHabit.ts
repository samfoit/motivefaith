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
      const offlinePayload = {
        habitId: params.habitId,
        type: params.type,
        evidenceUrl: params.evidenceUrl,
        notes: params.notes,
      };

      // Quick path: if obviously offline, skip the network attempt
      if (!navigator.onLine) {
        await queueCompletion(offlinePayload);
        return { queued: true } as const;
      }

      // Try-then-queue: attempt the network request, fall back to offline
      // queue on network errors (lie-fi, captive portals, etc.).
      try {
        const { data, error } = await supabase.rpc("insert_completion", {
          p_habit_id: params.habitId,
          p_completion_type: params.type,
          p_evidence_url: params.evidenceUrl,
          p_notes: params.notes,
        });

        if (error) throw error;
        return data;
      } catch (err) {
        // TypeError is thrown by fetch on network failure. Queue and retry
        // via Background Sync instead of losing the completion.
        if (err instanceof TypeError) {
          await queueCompletion(offlinePayload);
          return { queued: true } as const;
        }
        throw err; // Re-throw server/RLS errors
      }
    },
  });
}
