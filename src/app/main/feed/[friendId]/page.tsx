import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { JourneyClient } from "./journey-client";

export const revalidate = 30;
import type {
  JourneyData,
  JourneyHabit,
  JourneyCompletion,
  JourneyEncouragement,
  FeedProfile,
} from "@/lib/types/feed";

// -- RPC row shape (JSONB arrays parsed from get_friend_journey) -------------

type RpcHabit = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  owner_id: string;
  streak_current: number;
  streak_best: number;
  is_owner: boolean;
  completed_today: boolean;
};

type RpcCompletion = {
  id: string;
  habit_id: string;
  user_id: string;
  completion_type: string;
  evidence_url: string | null;
  notes: string | null;
  completed_at: string;
  habit_emoji: string;
  habit_title: string;
  habit_color: string;
};

type RpcEncouragement = {
  id: string;
  user_id: string;
  encouragement_type: string;
  content: string | null;
  created_at: string;
  completion_id: string | null;
};

type JourneyRpcRow = {
  habits: RpcHabit[];
  completions: RpcCompletion[];
  encouragements: RpcEncouragement[];
  user_timezone: string;
};

interface Props {
  params: Promise<{ friendId: string }>;
}

export default async function JourneyPage({ params }: Props) {
  const { friendId } = await params;
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  // 1. Verify friendship exists (auth gate — must run first)
  const { data: friendship } = await supabase
    .from("friendships")
    .select("id, created_at")
    .or(
      `and(register_id.eq.${user.id},addressee_id.eq.${friendId}),and(register_id.eq.${friendId},addressee_id.eq.${user.id})`,
    )
    .eq("status", "accepted")
    .single();

  if (!friendship) notFound();

  // 2. Profiles + journey RPC in parallel (single round-trip)
  const [{ data: friendProfile }, { data: myProfile }, { data: journeyRows }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, username")
        .eq("id", friendId)
        .single(),
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, username")
        .eq("id", user.id)
        .single(),
      untypedRpc<JourneyRpcRow[]>(supabase, "get_friend_journey", {
        p_user_id: user.id,
        p_friend_id: friendId,
      }),
    ]);

  if (!friendProfile) notFound();

  const friend: FeedProfile = friendProfile;
  const row = journeyRows?.[0];

  // 3. Map RPC results to existing types
  const habits: JourneyHabit[] = ((row?.habits ?? []) as RpcHabit[]).map(
    (h) => ({
      id: h.id,
      title: h.title,
      emoji: h.emoji,
      color: h.color,
      streak_current: h.streak_current,
      streak_best: h.streak_best,
      owner_id: h.owner_id,
      isOwner: h.is_owner,
      completedToday: h.completed_today,
    }),
  );

  const completions: JourneyCompletion[] = (
    (row?.completions ?? []) as RpcCompletion[]
  ).map((c) => ({
    id: c.id,
    habit_id: c.habit_id,
    completion_type: (c.completion_type ?? "quick") as JourneyCompletion["completion_type"],
    evidence_url: c.evidence_url,
    notes: c.notes,
    completed_at: c.completed_at,
    user_id: c.user_id,
    isMe: c.user_id === user.id,
    habit_emoji: c.habit_emoji,
    habit_title: c.habit_title,
    habit_color: c.habit_color,
  }));

  const encouragements: JourneyEncouragement[] = (
    (row?.encouragements ?? []) as RpcEncouragement[]
  ).map((e) => ({
    id: e.id,
    encouragement_type: (e.encouragement_type ?? "nudge") as JourneyEncouragement["encouragement_type"],
    content: e.content,
    created_at: e.created_at,
    user_id: e.user_id,
    isMe: e.user_id === user.id,
    sender_name:
      e.user_id === user.id
        ? myProfile?.display_name ?? "You"
        : friend.display_name,
    completion_id: e.completion_id ?? null,
  }));

  const journeyData: JourneyData = {
    friend,
    friendshipSince: friendship.created_at!,
    habits,
    completions,
    encouragements,
  };

  return <JourneyClient data={journeyData} userId={user.id} />;
}
