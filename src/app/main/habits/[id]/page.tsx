import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { HabitDetailClient } from "./habit-detail-client";
import { DEFAULT_TIMEZONE } from "@/lib/utils/timezone";
import { computeEffectiveStreak } from "@/lib/utils/streak";
import { mergePrivateContent } from "@/lib/utils/private-checkin";
import { untypedRpc } from "@/lib/supabase/rpc";
import {
  HABIT_ACTIVITY_DAYS,
  HABIT_ACTIVITY_MAX_ROWS,
  HISTORY_PAGE_SIZE,
} from "@/lib/constants/limits";

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

  const activitySince = new Date();
  activitySince.setDate(activitySince.getDate() - HABIT_ACTIVITY_DAYS);

  // Parallelize all independent queries (profile, habit, activity, history,
  // shares, group shares, friendships).
  //
  // Two reads of completions, because they answer different questions. The
  // heatmap, streak and "done today" need every day in the recent window, but
  // only its dates. The History tab needs whole rows, but only one page of
  // them at a time, reaching as far back as the habit goes — years of
  // logging is never fetched in one go. A third, counted in the database,
  // gives the rate its days done over the habit's whole life.
  const [
    { data: profileTz },
    { data: habit },
    { data: activity },
    { data: completions },
    { data: daysDone },
    { data: shares },
    { data: groupShares },
    { data: friendships },
  ] = await Promise.all([
    supabase.from("profiles").select("timezone, username").eq("id", user.id).single(),
    supabase
      .from("habits")
      .select("id, user_id, title, description, emoji, color, frequency, schedule, time_window, streak_current, streak_best, total_completions, is_paused, visibility, private_checkins, created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("completions")
      .select("id, completion_type, completed_at, rain_check_moved_to")
      .eq("habit_id", id)
      .gte("completed_at", activitySince.toISOString())
      .order("completed_at", { ascending: false })
      .limit(HABIT_ACTIVITY_MAX_ROWS),
    supabase
      .from("completions")
      // The embed brings back what a private check-in recorded (039). Inline
      // rather than PRIVATE_CONTENT_EMBED so postgrest-js can infer the type.
      .select("id, habit_id, completion_type, evidence_url, notes, completed_at, rain_check_reason, rain_check_moved_to, completion_private_content(completion_type, evidence_url, notes)")
      .eq("habit_id", id)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE),
    untypedRpc<number>(supabase, "get_habit_days_done", { p_habit_id: id }),
    supabase
      .from("habit_shares")
      .select("id, shared_with, notify_complete, notify_miss, created_at, status, initiated_by")
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

  const validatedCompletions = (completions ?? [])
    .filter(
      (c): c is typeof c & { completed_at: string } => c.completed_at != null,
    )
    .map(mergePrivateContent);
  const validatedActivity = (activity ?? []).filter(
    (c): c is typeof c & { completed_at: string } => c.completed_at != null,
  );

  const effectiveStreak = computeEffectiveStreak(habit, validatedActivity, timeZone);

  // Resolve dependent lookups in parallel.
  //
  // A declined row is deliberately not "live": it holds no access and the
  // owner may invite that person again, so they stay in availableFriends.
  const liveShares = (shares ?? []).filter(
    (s) => s.status === "accepted" || s.status === "pending",
  );
  const shareUserIds = liveShares
    .map((s) => s.shared_with)
    .filter((sid): sid is string => sid != null);
  const groupIds = (groupShares ?? []).map((s) => s.group_id);
  const friendIds = (friendships ?? [])
    .map((f) => (f.register_id === user.id ? f.addressee_id : f.register_id))
    .filter((fid) => !shareUserIds.includes(fid));

  const [shareProfiles, sharedGroupsRaw, availableFriends] = await Promise.all([
    shareUserIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, username").in("id", shareUserIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; display_name: string; avatar_url: string | null; username: string }[]),
    groupIds.length > 0
      ? supabase.from("groups").select("id, name, avatar_url").in("id", groupIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; name: string; avatar_url: string | null }[]),
    friendIds.length > 0
      ? supabase.from("profiles").select("id, display_name, avatar_url, username").in("id", friendIds).then(({ data }) => data ?? [])
      : Promise.resolve([] as { id: string; display_name: string; avatar_url: string | null; username: string }[]),
  ]);

  // One row per live partnership, carrying which way round it was started.
  // The owner is `user.id` here — the habit query filters on it — so a row
  // they initiated is an invitation, and anything else is a request.
  const partnerRows = liveShares
    .map((share) => {
      const profile = shareProfiles.find((p) => p.id === share.shared_with);
      if (!profile) return null;
      return {
        shareId: share.id,
        status: share.status as "accepted" | "pending",
        direction: (share.initiated_by === user.id ? "invite" : "request") as
          | "invite"
          | "request",
        notify_complete: share.notify_complete,
        notify_miss: share.notify_miss,
        profile,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

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
      activity={validatedActivity}
      // No count until migration 044 is applied: fall back to check-ins, which
      // is what the rate counted before.
      daysDone={daysDone ?? habit.total_completions ?? 0}
      partnerRows={partnerRows}
      availableFriends={availableFriends}
      sharedGroups={sharedGroups}
      timezone={timeZone}
      username={profileTz?.username ?? null}
    />
  );
}
