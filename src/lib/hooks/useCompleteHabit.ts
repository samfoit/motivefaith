"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { queueCompletion } from "@/lib/offline-queue";
import { notifyPendingChanged } from "@/lib/outbox-drain";
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
    // REQUIRED. React Query's default mutation networkMode is "online", which
    // checks `onlineManager.isOnline()` *before* calling mutationFn and parks
    // the mutation instead of running it:
    //
    //   const canStart = () => canFetch(config.networkMode) && config.canRun();
    //   start: () => { if (canStart()) run(); else pause().then(run); }
    //
    // Every offline path in this hook lives inside mutationFn, so under the
    // default, going offline meant the completion was neither sent nor
    // queued — it was silently lost on reload, while the UI showed it as
    // complete from the caller's own optimistic state. "always" hands us
    // control so the queue below is actually reached.
    networkMode: "always",
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
        notifyPendingChanged();
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
        // TypeError is thrown by fetch on network failure. Queue instead of
        // losing the completion; it is flushed by Background Sync, or by the
        // page-side drain on browsers without SyncManager (Safari/iOS).
        if (err instanceof TypeError) {
          await queueCompletion(offlinePayload);
          notifyPendingChanged();
          return { queued: true } as const;
        }
        throw err; // Re-throw server/RLS errors
      }
    },
  });
}
