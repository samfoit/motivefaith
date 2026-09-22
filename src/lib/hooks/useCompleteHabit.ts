"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queueCompletion } from "@/lib/offline-queue";
import type { CompletionType } from "@/lib/constants/completion";
import type { RainCheckReason } from "@/lib/constants/rain-check";

interface CompleteHabitParams {
  habitId: string;
  type: CompletionType;
  evidenceUrl?: string;
  notes?: string;
  /** Only meaningful for a "rain_check"; the RPC ignores it otherwise. */
  rainCheckReason?: RainCheckReason;
  /**
   * The day a rain check was moved to, as a YYYY-MM-DD key. Only meaningful
   * for a "rain_check"; absent means a plain skip.
   */
  rainCheckMovedTo?: string;
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
        rainCheckReason: params.rainCheckReason,
        rainCheckMovedTo: params.rainCheckMovedTo,
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
          p_rain_check_reason: params.rainCheckReason,
          p_rain_check_moved_to: params.rainCheckMovedTo,
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
