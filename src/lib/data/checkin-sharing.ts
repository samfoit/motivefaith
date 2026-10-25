"use client";

/**
 * Who a check-in goes to, for the one time the app asks before sending one.
 *
 * A check-in shows in each partner's chat, on each group's timeline and as a
 * push to them, and people new to the app don't expect that. So the first
 * check-in that would reach somebody waits until the user has said that's
 * fine; after that they are never asked again, on any device (migration 040).
 *
 * The answer is kept in the persisted query cache, so the question can be
 * settled offline too — from who each habit reached when last online.
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";

export interface AudienceMember {
  habit_id: string;
  kind: "partner" | "group";
  /** The partner's profile id, or the group's id. */
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface CheckinSharing {
  /** Said yes, on this device or another: never asked again. */
  confirmed: boolean;
  /** Every habit's partners and groups. Empty once confirmed. */
  audience: AudienceMember[];
  /** Said yes here while the server couldn't be told; it is told next fetch. */
  unsent?: boolean;
}

export function checkinSharingKey(userId: string | null): QueryKey {
  return ["checkin-sharing", userId];
}

/**
 * How old the audience may be when a check-in is about to go out. A partner
 * who accepted since then would otherwise get the first check-in unasked.
 */
export const CHECKIN_SHARING_FRESH_MS = 30 * 1000;

/**
 * Once the server has the yes there is nothing left to ask it, so the query
 * never runs again — not even on the app-wide refetch-on-focus. Until then it
 * stays fresh enough to catch a partner who has just accepted.
 */
export function checkinSharingStaleTime(data: CheckinSharing | undefined) {
  return data?.confirmed && !data.unsent
    ? ("static" as const)
    : CHECKIN_SHARING_FRESH_MS;
}

export async function fetchCheckinSharing(
  queryClient: QueryClient,
  userId: string | null,
): Promise<CheckinSharing> {
  const supabase = createClient();

  // A yes given offline goes first, so the answer below already has it.
  const cached = queryClient.getQueryData<CheckinSharing>(
    checkinSharingKey(userId),
  );
  if (cached?.unsent) {
    const { error } = await untypedRpc(supabase, "confirm_checkin_sharing");
    if (error) throw error;
  }

  const { data, error } = await untypedRpc<CheckinSharing>(
    supabase,
    "get_checkin_audience",
  );
  if (error) throw error;
  // Read wrong, a missing audience would look like one that reaches nobody
  // and let the check-in out unasked. An answer that can't be read is no
  // answer: the caller falls back to asking.
  if (typeof data?.confirmed !== "boolean" || !Array.isArray(data.audience)) {
    throw new Error("get_checkin_audience: unexpected response");
  }
  return { confirmed: data.confirmed, audience: data.audience };
}

/**
 * Who a check-in on these habits reaches — each partner or group once, even
 * when several of the habits reach them.
 */
export function audienceFor(
  sharing: CheckinSharing,
  habitIds: readonly string[],
): AudienceMember[] {
  const seen = new Set<string>();
  return sharing.audience.filter((member) => {
    if (!habitIds.includes(member.habit_id)) return false;
    const key = `${member.kind}:${member.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Record the yes: here at once, so this device never asks again whatever the
 * network does, and on the server as soon as it can be reached.
 */
export async function recordSharingConfirmed(
  queryClient: QueryClient,
  userId: string | null,
): Promise<void> {
  const queryKey = checkinSharingKey(userId);
  // A fetch already in flight still holds the old answer; landing after this
  // it would bring the question back.
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<CheckinSharing>(queryKey, {
    confirmed: true,
    audience: [],
    unsent: true,
  });

  try {
    const { error } = await untypedRpc(
      createClient(),
      "confirm_checkin_sharing",
    );
    if (error) throw error;
    queryClient.setQueryData<CheckinSharing>(queryKey, {
      confirmed: true,
      audience: [],
    });
  } catch {
    // Left marked unsent: fetchCheckinSharing sends it before anything else.
  }
}
