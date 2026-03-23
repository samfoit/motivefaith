"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
import type { FeedProfile } from "@/lib/types/feed";
import type { GroupMemberProfile } from "@/lib/types/groups";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch groups the user belongs to, with member count (single RPC) */
export function useGroupsList(userId: string | undefined) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["groups", "list", userId],
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await untypedRpc<{
        id: string;
        name: string;
        description: string | null;
        avatar_url: string | null;
        invite_code: string | null;
        settings: { allow_member_invites: boolean; require_approval: boolean };
        created_by: string;
        created_at: string;
        updated_at: string;
        my_role: string;
        member_count: number;
      }[]>(supabase, "get_user_groups", { p_user_id: userId });

      if (error) throw error;
      if (!data?.length) return [];

      return data.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        avatar_url: g.avatar_url,
        invite_code: g.invite_code,
        settings: g.settings,
        created_by: g.created_by,
        created_at: g.created_at,
        updated_at: g.updated_at,
        memberCount: g.member_count,
        myRole: g.my_role as "admin" | "member",
      }));
    },
  });
}

/** Shape returned by the FK-joined group detail query (not in generated types). */
type JoinedMember = {
  id: string;
  group_id: string;
  user_id: string;
  role: "admin" | "member" | null;
  joined_at: string | null;
  profile: FeedProfile | null;
};

type GroupDetailRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  invite_code: string | null;
  settings: { allow_member_invites: boolean; require_approval: boolean };
  created_by: string;
  created_at: string;
  updated_at: string;
  group_members: JoinedMember[];
};

/** Fetch full group details (members with profiles) — single FK join query */
export function useGroupDetails(groupId: string | undefined) {
  const supabase = createClient();

  return useQuery({
    queryKey: ["groups", "detail", groupId],
    enabled: !!groupId,
    staleTime: 60 * 1000, // 1 minute
    queryFn: async () => {
      if (!groupId) return null;

      // Single query: group + members with embedded profile via FK join.
      // .returns<T>() overrides the inferred type for dynamic select strings
      // that aren't reflected in the auto-generated Database types.
      const { data: group, error } = await supabase
        .from("groups")
        .select(
          "id, name, description, avatar_url, invite_code, settings, created_by, created_at, updated_at, " +
          "group_members(id, group_id, user_id, role, joined_at, " +
            "profile:profiles!user_id(id, display_name, avatar_url, username))"
        )
        .eq("id", groupId)
        .returns<GroupDetailRow[]>()
        .single();

      if (error) throw error;

      const membersWithProfiles: GroupMemberProfile[] = (group.group_members ?? [])
        .filter((m): m is JoinedMember & { profile: FeedProfile } => m.profile !== null)
        .map((m) => ({
          id: m.id,
          group_id: m.group_id,
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          notification_prefs: null,
          profile: m.profile,
        }));

      // Separate group data from the nested members
      const { group_members: _, ...groupData } = group;

      return { group: groupData, members: membersWithProfiles };
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a new group + add creator as admin (atomic via RPC) */
export function useCreateGroup() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      avatarUrl,
      initialMemberIds,
    }: {
      name: string;
      description?: string;
      avatarUrl?: string;
      createdBy: string;
      initialMemberIds?: string[];
    }) => {
      // Generate invite code
      const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Atomic RPC: creates the group, adds creator as admin, and adds
      // initial members in a single transaction (bypasses the admin-only
      // INSERT policy on group_members safely via SECURITY DEFINER).
      const { data, error } = await untypedRpc(supabase, "create_group", {
        p_name: name,
        p_description: description || null,
        p_avatar_url: avatarUrl || null,
        p_invite_code: inviteCode,
        p_initial_member_ids: initialMemberIds ?? [],
      });

      if (error) throw error;

      const group = Array.isArray(data) ? data[0] : data;
      if (!group) throw new Error("Failed to create group");

      return group;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Update group details */
export function useUpdateGroup() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      updates,
    }: {
      groupId: string;
      updates: {
        name?: string;
        description?: string | null;
        avatar_url?: string | null;
        settings?: { allow_member_invites: boolean; require_approval: boolean };
      };
    }) => {
      const { error } = await supabase
        .from("groups")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", groupId);

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Delete a group */
export function useDeleteGroup() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("groups")
        .delete()
        .eq("id", groupId);

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Add members to a group */
export function useAddGroupMembers() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      userIds,
    }: {
      groupId: string;
      userIds: string[];
    }) => {
      const { error } = await supabase
        .from("group_members")
        .insert(
          userIds.map((uid) => ({
            group_id: groupId,
            user_id: uid,
            role: "member" as const,
          })),
        );

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Remove a member from a group */
export function useRemoveGroupMember() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      userId,
    }: {
      groupId: string;
      userId: string;
    }) => {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Update a member's role */
export function useUpdateMemberRole() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      userId,
      role,
    }: {
      groupId: string;
      userId: string;
      role: "admin" | "member";
    }) => {
      const { error } = await supabase
        .from("group_members")
        .update({ role })
        .eq("group_id", groupId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Join a group via invite code */
export function useJoinGroupByInvite() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ inviteCode }: { inviteCode: string }) => {
      const { data: rows, error } = await untypedRpc<
        { group_id: string; group_name: string }[]
      >(supabase, "join_group_by_invite_code", { p_code: inviteCode });

      if (error) throw error;
      const group = rows?.[0] ?? null;
      if (!group) throw new Error("Invalid invite code");
      return { id: group.group_id, name: group.group_name };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Regenerate the invite code for a group */
export function useRegenerateInviteCode() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string) => {
      const newCode = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { error } = await supabase
        .from("groups")
        .update({ invite_code: newCode, updated_at: new Date().toISOString() })
        .eq("id", groupId);

      if (error) throw error;
      return newCode;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}
