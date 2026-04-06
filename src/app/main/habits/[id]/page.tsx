import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { HabitDetailClient } from "./habit-detail-client";
import { DEFAULT_TIMEZONE } from "@/lib/utils/timezone";
import { computeEffectiveStreak } from "@/lib/utils/streak";

export const revalidate = 60;

interface Props {
  params: Promise<{ id: string }>;
}

export default async function HabitDetailPage({ params }: Props) {
  const { id } = await params;
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Parallelize all independent queries (profile, habit, completions, shares, group shares, friendships)
  const [
    { data: profileTz },
    { data: habit },
    { data: completions },
    { data: shares },
    { data: groupShares },
    { data: friendships },
  ] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).single(),
    supabase
      .from("habits")
      .select("id, user_id, title, description, emoji, category, color, frequency, schedule, time_window, streak_current, streak_best, total_completions, is_paused, is_shared, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("completions")
      .select("id, habit_id, completion_type, evidence_url, notes, completed_at")
      .eq("habit_id", id)
      .gte("completed_at", ninetyDaysAgo.toISOString())
      .order("completed_at", { ascending: false })
      .limit(50),
    supabase
      .from("habit_shares")
      .select("id, shared_with, notify_complete, notify_miss, created_at")
      .eq("habit_id", id),
    supabase
      .from("group_habit_shares")
      .select("id, group_id, shared_by, created_at")
      .eq("habit_id", id),
    supabase
      .from("friendships")
      .select("register_id, addressee_id")
      .or(`register_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq("status", "accepted"),
  ]);

  const timeZone = profileTz?.timezone || DEFAULT_TIMEZONE;

  if (!habit) notFound();

  const validatedCompletions = (completions ?? []).filter(
    (c): c is typeof c & { completed_at: string } => c.completed_at != null,
  );

  const effectiveStreak = computeEffectiveStreak(habit, validatedCompletions, timeZone);

  // Resolve dependent lookups in parallel
  const partnerIds = (shares ?? []).map((s) => s.shared_with).filter((sid): sid is string => sid != null);
  const groupIds = (groupShares ?? []).map((s) => s.group_id);
  const friendIds = (friendships ?? [])
    .map((f) => (f.register_id === user.id ? f.addressee_id : f.register_id))
    .filter((fid) => !partnerIds.includes(fid));

  const [partners, sharedGroupsRaw, availableFriends] = await Promise.all([
    partnerIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, username").in("id", partnerIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; display_name: string; avatar_url: string | null; username: string }[]),
    groupIds.length > 0
      ? supabase.from("groups").select("id, name, avatar_url").in("id", groupIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; name: string; avatar_url: string | null }[]),
    friendIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, username").in("id", friendIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; display_name: string; avatar_url: string | null; username: string }[]),
  ]);

  const sharedGroups = sharedGroupsRaw
    .map((g) => {
      const share = (groupShares ?? []).find((s) => s.group_id === g.id);
      if (!share) return null;
      return { ...g, shareId: share.id };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  return (
    <HabitDetailClient
      habit={{ ...habit, streak_current: effectiveStreak }}
      completions={validatedCompletions}
      shares={shares ?? []}
      partners={partners}
      availableFriends={availableFriends}
      sharedGroups={sharedGroups}
      timezone={timeZone}
    />
  );
}
