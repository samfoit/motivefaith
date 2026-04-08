import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { GroupTimelineClient } from "./group-timeline-client";

export const revalidate = 30;
import type {
  GroupTimelineData,
  GroupTimelineCompletion,
  GroupTimelineMessage,
  GroupMemberProfile,
  GroupChallenge,
  GroupChallengeParticipant,
} from "@/lib/types/groups";
import type { FeedProfile } from "@/lib/types/feed";

// -- RPC row shape (JSONB arrays from get_group_timeline_activity) -----------

type RpcGroupHabit = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  category: string;
  streak_current: number;
  owner_id: string;
  owner_name: string;
  owner_avatar: string | null;
  completed_today: boolean;
};

type RpcGroupCompletion = {
  id: string;
  habit_id: string;
  user_id: string;
  completion_type: string;
  evidence_url: string | null;
  notes: string | null;
  completed_at: string;
  user_name: string;
  user_avatar: string | null;
  habit_emoji: string;
  habit_title: string;
  habit_color: string;
  reactions: { id: string; user_id: string; emoji: string }[];
};

type GroupActivityRpcRow = {
  habits: RpcGroupHabit[];
  completions: RpcGroupCompletion[];
  user_timezone: string;
};

interface Props {
  params: Promise<{ groupId: string }>;
}

export default async function GroupTimelinePage({ params }: Props) {
  const { groupId } = await params;
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  // RT1: Base queries in parallel (membership, group, members, challenges, messages)
  const [
    { data: myMembership },
    { data: group },
    { data: members },
    { data: challenges },
    { data: msgRows },
  ] = await Promise.all([
    supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", user.id).single(),
    supabase.from("groups").select("id, name, invite_code").eq("id", groupId).single(),
    supabase.from("group_members").select("id, group_id, user_id, role, joined_at").eq("group_id", groupId),
    supabase.from("group_challenges").select("id, group_id, title, description, emoji, start_date, end_date, is_active, created_by, created_at").eq("group_id", groupId).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("group_messages").select("id, user_id, content, created_at").eq("group_id", groupId).order("created_at", { ascending: false }).limit(50),
  ]);

  if (!myMembership) notFound();
  if (!group) notFound();

  // RT2: Dependent queries + RPC in parallel
  const memberUserIds = (members ?? []).map((m) => m.user_id);
  const challengeIds = (challenges ?? []).map((c) => c.id);
  const messageIds = (msgRows ?? []).map((m) => m.id);

  const [
    { data: memberProfileRows },
    challengeParticipantRows,
    { data: msgReactions },
    { data: activityRows },
  ] = await Promise.all([
    memberUserIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, username").in("id", memberUserIds)
      : Promise.resolve({ data: [] as FeedProfile[] }),
    challengeIds.length > 0
      ? supabase.from("group_challenge_participants").select("id, challenge_id, user_id, habit_id, joined_at").in("challenge_id", challengeIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; challenge_id: string; user_id: string; habit_id: string | null; joined_at: string }[]),
    messageIds.length > 0
      ? supabase.from("group_message_reactions").select("id, message_id, user_id, emoji").in("message_id", messageIds)
      : Promise.resolve({ data: [] as { id: string; message_id: string; user_id: string; emoji: string }[] }),
    untypedRpc<GroupActivityRpcRow[]>(supabase, "get_group_timeline_activity", {
      p_group_id: groupId,
      p_user_id: user.id,
    }),
  ]);

  const memberProfiles = memberProfileRows ?? [];
  const profileMap = new Map(memberProfiles.map((p) => [p.id, p]));

  const membersWithProfiles: GroupMemberProfile[] = (members ?? [])
    .map((m) => {
      const profile = profileMap.get(m.user_id);
      if (!profile) return null;
      return { ...m, profile } as GroupMemberProfile;
    })
    .filter(Boolean) as GroupMemberProfile[];

  // RT3 (conditional): Resolve missing participant profiles
  const participantUserIds = [...new Set(challengeParticipantRows.map((p) => p.user_id))];
  const missingParticipantIds = participantUserIds.filter((id) => !profileMap.has(id));

  if (missingParticipantIds.length > 0) {
    const { data: partProfiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url, username")
      .in("id", missingParticipantIds);
    for (const p of partProfiles ?? []) {
      profileMap.set(p.id, p);
    }
  }

  const challengeParticipants = challengeParticipantRows
    .map((p) => {
      const profile = profileMap.get(p.user_id);
      if (!profile) return null;
      return { ...p, profile };
    })
    .filter(Boolean) as (GroupChallengeParticipant & { profile: FeedProfile })[];

  // Map RPC results to existing types
  const row = activityRows?.[0];

  const habits: GroupTimelineData["habits"] = (
    (row?.habits ?? []) as RpcGroupHabit[]
  ).map((h) => ({
    id: h.id,
    title: h.title,
    emoji: h.emoji,
    color: h.color,
    category: h.category,
    streak_current: h.streak_current,
    owner_id: h.owner_id,
    owner_name: h.owner_name,
    owner_avatar: h.owner_avatar,
    completedToday: h.completed_today,
  }));

  const completions: GroupTimelineCompletion[] = (
    (row?.completions ?? []) as RpcGroupCompletion[]
  ).map((c) => ({
    id: c.id,
    habit_id: c.habit_id,
    completion_type: (c.completion_type ?? "quick") as GroupTimelineCompletion["completion_type"],
    evidence_url: c.evidence_url,
    notes: c.notes,
    completed_at: c.completed_at,
    user_id: c.user_id,
    isMe: c.user_id === user.id,
    user_name: c.user_name,
    user_avatar: c.user_avatar,
    habit_emoji: c.habit_emoji,
    habit_title: c.habit_title,
    habit_color: c.habit_color,
    reactions: c.reactions,
  }));

  // Build message reactions map
  const reactionsByMessage = new Map<
    string,
    { id: string; user_id: string; emoji: string }[]
  >();
  for (const r of msgReactions ?? []) {
    const existing = reactionsByMessage.get(r.message_id) ?? [];
    existing.push({ id: r.id, user_id: r.user_id, emoji: r.emoji });
    reactionsByMessage.set(r.message_id, existing);
  }

  const messages: GroupTimelineMessage[] = (msgRows ?? [])
    .filter((m) => m.created_at != null)
    .map((m) => {
      const userProfile = profileMap.get(m.user_id);
      return {
        id: m.id,
        content: m.content,
        created_at: m.created_at!,
        user_id: m.user_id,
        isMe: m.user_id === user.id,
        user_name: userProfile?.display_name ?? "Unknown",
        user_avatar: userProfile?.avatar_url ?? null,
        reactions: reactionsByMessage.get(m.id),
      };
    });

  // Assemble challenge data with participants
  const challengesWithParticipants = (challenges ?? []).map((c) => {
    const cParticipants = challengeParticipants.filter(
      (p) => p.challenge_id === c.id,
    );
    const myParticipation = cParticipants.find(
      (p) => p.user_id === user.id,
    ) ?? null;

    return {
      ...c,
      participants: cParticipants,
      myParticipation,
    } as GroupChallenge & {
      participants: (GroupChallengeParticipant & { profile: FeedProfile })[];
      myParticipation: GroupChallengeParticipant | null;
    };
  });

  const data: GroupTimelineData = {
    group,
    members: membersWithProfiles,
    habits,
    completions,
    messages,
    challenges: challengesWithParticipants,
    myRole: myMembership.role as "admin" | "member",
  };

  return <GroupTimelineClient data={data} userId={user.id} />;
}
