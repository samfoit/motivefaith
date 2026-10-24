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
