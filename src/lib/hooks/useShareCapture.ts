"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import { useFeedStaleStore } from "@/lib/stores/feed-stale-store";

export interface ShareCaptureParams {
  /** Storage path of the already-uploaded file in the `completions` bucket. */
  mediaPath: string;
  mediaType: "photo" | "video";
  caption?: string;
  habitIds: string[];
  friendIds: string[];
  groupIds: string[];
}

export interface ShareCaptureResult {
  completion_ids: string[];
  encouragement_ids: string[];
  group_message_ids: string[];
}

/**
 * Send one uploaded capture to any mix of habits, friends and groups.
 *
 * `share_capture` inserts every row in one transaction, so a send either
 * lands everywhere or nowhere. Not queued offline: the upload before it needs
 * the network anyway, the same as a photo check-in.
 */
export function useShareCapture() {
  const supabase = createClient();

  return useMutation({
    mutationFn: async (params: ShareCaptureParams) => {
      const { data, error } = await untypedRpc<ShareCaptureResult>(
        supabase,
        "share_capture",
        {
          p_media_path: params.mediaPath,
          p_media_type: params.mediaType,
          p_caption: params.caption ?? null,
          p_habit_ids: params.habitIds,
          p_friend_ids: params.friendIds,
          p_group_ids: params.groupIds,
        },
      );

      if (error) throw error;
      // Check-ins, DMs and group messages all show up in feed previews.
      useFeedStaleStore.getState().markStale();
      return data;
    },
  });
}
