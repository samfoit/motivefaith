"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FriendProfile = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

export type Friendship = {
  id: string;
  register_id: string;
  addressee_id: string;
  status: "pending" | "accepted" | "blocked";
  created_at: string;
};

export type FriendWithProfile = Friendship & {
  profile: FriendProfile;
};

/** Shape returned by FK-joined friendship query (not in generated types). */
type FriendshipWithProfiles = {
  id: string;
  register_id: string;
  addressee_id: string;
  status: string;
  created_at: string;
  register: FriendProfile | null;
  addressee: FriendProfile | null;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch accepted friends with their profiles (single query via FK join) */
export function useFriendsList(userId: string | undefined, options?: { initialData?: FriendWithProfile[] }) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["friends", "list", userId],
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    ...(options?.initialData ? { initialData: options.initialData } : {}),
    queryFn: async () => {
      if (!userId) return [];

      // Single query: embed both FK-referenced profiles so we avoid the
      // second round-trip that was previously an N+1 pattern.
      // The aliased FK join syntax isn't reflected in generated types,
      // so we cast the result to our known shape.
      const { data, error } = await supabase
        .from("friendships")
        .select(
          "id, register_id, addressee_id, status, created_at, " +
          "register:profiles!register_id(id, display_name, username, avatar_url), " +
          "addressee:profiles!addressee_id(id, display_name, username, avatar_url)"
        )
        .eq("status", "accepted")
        .or(`register_id.eq.${userId},addressee_id.eq.${userId}`)
        .returns<FriendshipWithProfiles[]>();

      if (error) throw error;
      const friendships = data ?? [];
      if (!friendships.length) return [];

      return friendships
        .map((f) => {
          // Pick the "other" user's profile
          const profile = f.register_id === userId
            ? f.addressee
            : f.register;
          if (!profile) return null;
          return {
            id: f.id,
            register_id: f.register_id,
            addressee_id: f.addressee_id,
            status: f.status,
            created_at: f.created_at,
            profile,
          } as FriendWithProfile;
        })
        .filter(Boolean) as FriendWithProfile[];
    },
  });
}

/** Fetch pending requests (both incoming and outgoing, single query via FK join) */
export function useFriendRequests(userId: string | undefined, options?: { initialData?: { incoming: FriendWithProfile[]; outgoing: FriendWithProfile[] } }) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["friends", "requests", userId],
    enabled: !!userId,
    staleTime: 60 * 1000, // 1 minute
    ...(options?.initialData ? { initialData: options.initialData } : {}),
    queryFn: async () => {
      if (!userId) return { incoming: [], outgoing: [] };

      const { data, error } = await supabase
        .from("friendships")
        .select(
          "id, register_id, addressee_id, status, created_at, " +
          "register:profiles!register_id(id, display_name, username, avatar_url), " +
          "addressee:profiles!addressee_id(id, display_name, username, avatar_url)"
        )
        .eq("status", "pending")
        .or(`register_id.eq.${userId},addressee_id.eq.${userId}`)
        .returns<FriendshipWithProfiles[]>();

      if (error) throw error;
      const friendships = data ?? [];
      if (!friendships.length)
        return { incoming: [] as FriendWithProfile[], outgoing: [] as FriendWithProfile[] };

      const withProfiles = friendships
        .map((f) => {
          const profile = f.register_id === userId
            ? f.addressee
            : f.register;
          if (!profile) return null;
          return {
            id: f.id,
            register_id: f.register_id,
            addressee_id: f.addressee_id,
            status: f.status,
            created_at: f.created_at,
            profile,
          } as FriendWithProfile;
        })
        .filter(Boolean) as FriendWithProfile[];

      return {
        incoming: withProfiles.filter((f) => f.addressee_id === userId),
        outgoing: withProfiles.filter((f) => f.register_id === userId),
      };
    },
  });
}

/** Search profiles by username via rate-limited RPC (debounced at the call site) */
export function useSearchUsers(query: string, currentUserId: string | undefined) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["friends", "search", query],
    enabled: query.length >= 2 && !!currentUserId,
    staleTime: 30 * 1000, // 30 seconds
    queryFn: async () => {
      // Uses the search_profiles RPC which is SECURITY DEFINER (bypasses
      // the scoped profiles SELECT policy) and rate-limited to 30/min.
      const { data, error } = await untypedRpc<FriendProfile[]>(
        supabase,
        "search_profiles",
        { p_query: query },
      );

      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useSendFriendRequest() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requesterId,
      addresseeId,
    }: {
      requesterId: string;
      addresseeId: string;
    }) => {
      const { data, error } = await supabase
        .from("friendships")
        .insert({
          register_id: requesterId,
          addressee_id: addresseeId,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSettled: () => {
      // Only requests change — new pending row, list stays the same
      queryClient.invalidateQueries({ queryKey: ["friends", "requests"] });
    },
  });
}

export function useAcceptFriendRequest() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase
        .from("friendships")
        .update({ status: "accepted" })
        .eq("id", friendshipId);

      if (error) throw error;
    },
    onSettled: () => {
      // Row moves from pending → accepted: both queries stale
      queryClient.invalidateQueries({ queryKey: ["friends", "list"] });
      queryClient.invalidateQueries({ queryKey: ["friends", "requests"] });
      queryClient.invalidateQueries({ queryKey: ["pending-requests"] });
    },
  });
}

export function useDeclineFriendRequest() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("id", friendshipId);

      if (error) throw error;
    },
    onSettled: () => {
      // Only requests change — pending row deleted, list unaffected
      queryClient.invalidateQueries({ queryKey: ["friends", "requests"] });
      queryClient.invalidateQueries({ queryKey: ["pending-requests"] });
    },
  });
}

export function useRemoveFriend() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("id", friendshipId);

      if (error) throw error;
    },
    onSettled: () => {
      // Only list changes — accepted row deleted, requests unaffected
      queryClient.invalidateQueries({ queryKey: ["friends", "list"] });
    },
  });
}
