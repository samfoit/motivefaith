"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import {
  CHECKIN_SHARING_FRESH_MS,
  audienceFor,
  checkinSharingKey,
  checkinSharingStaleTime,
  fetchCheckinSharing,
  type CheckinSharing,
} from "@/lib/data/checkin-sharing";
import { useCheckinSharingStore } from "@/lib/stores/checkin-sharing-store";

/**
 * Keeps the answer warm, and in the persisted cache, so a check-in can be
 * let through the moment it is made — offline included. Mounted once, by the
 * dialog that asks the question.
 */
export function useCheckinSharing() {
  const queryClient = useQueryClient();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: checkinSharingKey(userId),
    queryFn: () => fetchCheckinSharing(queryClient, userId),
    enabled: !!userId,
    staleTime: (query) => checkinSharingStaleTime(query.state.data),
    // The app-wide "always" ignores staleTime and would ask the server on
    // every return to the app, long after there is anything left to ask.
    refetchOnWindowFocus: true,
  });
}

/**
 * Call before a check-in goes out. Resolves true to send it, false when the
 * user would rather not.
 *
 * Only the first check-in that would reach somebody is ever held: once the
 * user has said yes, on any device, or when these habits reach nobody, this
 * answers straight away and shows nothing.
 */
export function useConfirmSharing() {
  const queryClient = useQueryClient();
  const userId = useAuthUserId();

  return useCallback(
    async (habitIds: readonly string[]): Promise<boolean> => {
      if (habitIds.length === 0) return true;
      const queryKey = checkinSharingKey(userId);

      let sharing = queryClient.getQueryData<CheckinSharing>(queryKey);
      if (!sharing?.confirmed) {
        try {
          sharing = await queryClient.fetchQuery({
            queryKey,
            queryFn: () => fetchCheckinSharing(queryClient, userId),
            staleTime: CHECKIN_SHARING_FRESH_MS,
          });
        } catch {
          // Offline, or the server couldn't answer: go by the last answer.
          sharing = queryClient.getQueryData<CheckinSharing>(queryKey);
        }
      }

      if (sharing?.confirmed) return true;
      // Never known, and can't be found out now: asked without names rather
      // than sent unasked.
      const audience = sharing ? audienceFor(sharing, habitIds) : null;
      if (audience && audience.length === 0) return true;
      return useCheckinSharingStore.getState().ask(audience);
    },
    [queryClient, userId],
  );
}

/**
 * What the last answer says, without asking anyone: true when a check-in on
 * these habits reaches nobody the user hasn't said yes to. They have said
 * yes, or the last look found nobody on these habits.
 *
 * That look may be out of date (a partner may have accepted since), so this
 * never decides whether a check-in is sent; `confirmSharing` does. It lets a
 * check-in whose write waits on that answer anyway show before the answer is
 * in, rather than leaving the tap doing nothing for a round trip.
 */
export function useSharingLooksClear() {
  const queryClient = useQueryClient();
  const userId = useAuthUserId();

  return useCallback(
    (habitIds: readonly string[]): boolean => {
      const sharing = queryClient.getQueryData<CheckinSharing>(
        checkinSharingKey(userId),
      );
      if (!sharing) return false;
      return sharing.confirmed || audienceFor(sharing, habitIds).length === 0;
    },
    [queryClient, userId],
  );
}

/**
 * Bring the answer up to date ahead of a check-in that looks about to be
 * asked for, so `confirmSharing` finds it fresh. Nothing is fetched once the
 * server has the yes.
 */
export function usePrefetchSharing() {
  const queryClient = useQueryClient();
  const userId = useAuthUserId();

  return useCallback(() => {
    if (!userId) return;
    void queryClient.prefetchQuery({
      queryKey: checkinSharingKey(userId),
      queryFn: () => fetchCheckinSharing(queryClient, userId),
      staleTime: (query) => checkinSharingStaleTime(query.state.data),
    });
  }, [queryClient, userId]);
}
