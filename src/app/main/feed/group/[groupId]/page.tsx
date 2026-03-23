import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
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

  // Parallelize: membership check, group details, members, habit shares, challenges, messages
  const [
    { data: myMembership },
    { data: group },
    { data: members },
    { data: habitShares },
    { data: challenges },
    { data: msgRows },
  ] = await Promise.all([
    supabase.from("group_members").select("role").eq("group_id", groupId).eq("user_id", user.id).single(),
    supabase.from("groups").select("id, name, description, avatar_url, invite_code, settings, created_by, created_at, updated_at").eq("id", groupId).single(),
    supabase.from("group_members").select("id, group_id, user_id, role, joined_at").eq("group_id", groupId),
    supabase.from("group_habit_shares").select("habit_id, shared_by").eq("group_id", groupId),
    supabase.from("group_challenges").select("id, group_id, title, description, emoji, start_date, end_date, is_active, created_by, created_at").eq("group_id", groupId).eq("is_active", true).order("created_at", { ascending: false }),
    supabase.from("group_messages").select("id, user_id, content, created_at").eq("group_id", groupId).order("created_at", { ascending: false }).limit(50),
  ]);

  if (!myMembership) notFound();
  if (!group) notFound();

  // Second wave: fetch dependent data in parallel
  const memberUserIds = (members ?? []).map((m) => m.user_id);
  const sharedHabitIds = (habitShares ?? []).map((s) => s.habit_id);
  const challengeIds = (challenges ?? []).map((c) => c.id);
  const messageIds = (msgRows ?? []).map((m) => m.id);

  const [
    { data: memberProfileRows },
    challengeParticipantRows,
    { data: msgReactions },
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

  // Resolve challenge participant profiles (reuse profileMap from members where possible)
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

  // Collect all habit IDs and fetch habits + completions in parallel
  const challengeHabitIds = challengeParticipants
    .map((p) => p.habit_id)
    .filter(Boolean) as string[];

  const allHabitIds = [...new Set([...sharedHabitIds, ...challengeHabitIds])];
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [habitDetailsResult, compRowsResult] = await Promise.all([
    allHabitIds.length > 0
      ? supabase.from("habits").select("id, title, emoji, color, category, streak_current, user_id").in("id", allHabitIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; title: string; emoji: string | null; color: string | null; category: string | null; streak_current: number | null; user_id: string }[]),
    allHabitIds.length > 0
      ? supabase.from("completions").select("id, habit_id, user_id, completion_type, evidence_url, notes, completed_at").in("habit_id", allHabitIds).gte("completed_at", thirtyDaysAgo.toISOString()).order("completed_at", { ascending: false }).limit(100).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; habit_id: string | null; user_id: string; completion_type: string | null; evidence_url: string | null; notes: string | null; completed_at: string | null }[]),
  ]);

  const habitMap = new Map(habitDetailsResult.map((h) => [h.id, h]));
  const todayStr = new Date().toISOString().split("T")[0];
  const completedTodaySet = new Set<string>();

  for (const c of compRowsResult) {
    if (!c.completed_at || !c.habit_id) continue;
    if (c.completed_at.startsWith(todayStr)) {
      completedTodaySet.add(`${c.habit_id}:${c.user_id}`);
    }
  }

  // Fetch completion reactions
  const completionIds = compRowsResult.map((c) => c.id);
  const completionReactionsByCompletion = new Map<
    string,
    { id: string; user_id: string; emoji: string }[]
  >();

  if (completionIds.length > 0) {
    const { data: compReactions } = await supabase
      .from("group_completion_reactions")
      .select("id, completion_id, user_id, emoji")
      .in("completion_id", completionIds);

    for (const r of compReactions ?? []) {
      const existing = completionReactionsByCompletion.get(r.completion_id) ?? [];
      existing.push({ id: r.id, user_id: r.user_id, emoji: r.emoji });
      completionReactionsByCompletion.set(r.completion_id, existing);
    }
  }

  const completions: GroupTimelineCompletion[] = compRowsResult
    .filter((c) => c.habit_id != null && c.completed_at != null)
    .map((c) => {
      const habit = habitMap.get(c.habit_id!);
      const userProfile = profileMap.get(c.user_id);
      return {
        id: c.id,
        habit_id: c.habit_id!,
        completion_type: (c.completion_type ?? "quick") as GroupTimelineCompletion["completion_type"],
        evidence_url: c.evidence_url,
        notes: c.notes,
        completed_at: c.completed_at!,
        user_id: c.user_id,
        isMe: c.user_id === user.id,
        user_name: userProfile?.display_name ?? "Unknown",
        user_avatar: userProfile?.avatar_url ?? null,
        habit_emoji: habit?.emoji ?? "",
        habit_title: habit?.title ?? "",
        habit_color: habit?.color ?? "",
        reactions: completionReactionsByCompletion.get(c.id),
      };
    });

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

  // 9. Build habits list for display
  const habits = sharedHabitIds
    .map((hid) => {
      const h = habitMap.get(hid);
      if (!h) return null;
      const ownerProfile = profileMap.get(h.user_id);
      return {
        id: h.id,
        title: h.title,
        emoji: h.emoji ?? "✅",
        color: h.color ?? "#6366F1",
        category: h.category ?? "general",
        streak_current: h.streak_current ?? 0,
        owner_id: h.user_id,
        owner_name: ownerProfile?.display_name ?? "Unknown",
        owner_avatar: ownerProfile?.avatar_url ?? null,
        completedToday: completedTodaySet.has(`${h.id}:${h.user_id}`),
      };
    })
    .filter(Boolean) as GroupTimelineData["habits"];

  // 10. Assemble challenge data with participants
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
    group: {
      ...group,
      settings: group.settings as GroupTimelineData["group"]["settings"],
    },
    members: membersWithProfiles,
    habits,
    completions,
    messages,
    challenges: challengesWithParticipants,
    myRole: myMembership.role as "admin" | "member",
  };

  return <GroupTimelineClient data={data} userId={user.id} />;
}
