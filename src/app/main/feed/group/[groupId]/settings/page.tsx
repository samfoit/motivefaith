import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { SettingsClient } from "./settings-client";
import type { GroupMemberProfile } from "@/lib/types/groups";
import type { FeedProfile } from "@/lib/types/feed";

interface Props {
  params: Promise<{ groupId: string }>;
}

export default async function GroupSettingsPage({ params }: Props) {
  const { groupId } = await params;
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  // Verify admin role, fetch group, and fetch members in parallel.
  // All three only depend on groupId (no data dependency between them).
  const [{ data: myMembership }, { data: group }, { data: members }] =
    await Promise.all([
      supabase
        .from("group_members")
        .select("role")
        .eq("group_id", groupId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("groups")
        .select(
          "id, name, description, avatar_url, invite_code, settings, created_by, created_at, updated_at",
        )
        .eq("id", groupId)
        .single(),
      supabase
        .from("group_members")
        .select("id, group_id, user_id, role, joined_at")
        .eq("group_id", groupId),
    ]);

  if (!myMembership || myMembership.role !== "admin") notFound();
  if (!group) notFound();

  // Fetch member profiles (depends on member list from above)
  const memberUserIds = (members ?? []).map((m) => m.user_id);
  let profiles: FeedProfile[] = [];
  if (memberUserIds.length > 0) {
    const { data: p } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, username")
      .in("id", memberUserIds);
    profiles = p ?? [];
  }

  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const membersWithProfiles: GroupMemberProfile[] = (members ?? [])
    .map((m) => {
      const profile = profileMap.get(m.user_id);
      if (!profile) return null;
      return { ...m, profile } as GroupMemberProfile;
    })
    .filter(Boolean) as GroupMemberProfile[];

  return (
    <SettingsClient
      group={{
        ...group,
        settings: group.settings as { allow_member_invites: boolean; require_approval: boolean },
      }}
      members={membersWithProfiles}
      userId={user.id}
    />
  );
}
