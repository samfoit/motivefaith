import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { JourneyClient } from "./journey-client";

export const revalidate = 30;
import type {
  JourneyData,
  JourneyHabit,
  JourneyCompletion,
  JourneyEncouragement,
  FeedProfile,
} from "@/lib/types/feed";

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

  // 1. Verify friendship exists
  const { data: friendship } = await supabase
    .from("friendships")
    .select("id, created_at")
    .or(
      `and(register_id.eq.${user.id},addressee_id.eq.${friendId}),and(register_id.eq.${friendId},addressee_id.eq.${user.id})`,
    )
    .eq("status", "accepted")
    .single();

  if (!friendship) notFound();

  // 2. Get profiles
  const [{ data: friendProfile }, { data: myProfile }] = await Promise.all([
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
  ]);

  if (!friendProfile) notFound();

  const friend: FeedProfile = friendProfile;

  // 3. Get shared habits
  // Start independent queries in parallel
  const myHabitsPromise = supabase
    .from("habits")
    .select("id")
    .eq("user_id", user.id);

  // Direction B: friend's habits shared with me
  const dirBPromise = supabase
    .from("habit_shares")
    .select("habit_id")
    .eq("shared_with", user.id);

  const [{ data: myHabits }, dirBResult] = await Promise.all([myHabitsPromise, dirBPromise]);

  // Direction A: my habits shared with friend (depends on myHabitIds)
  const myHabitIds = (myHabits ?? []).map((h) => h.id);

  const dirAResult =
    myHabitIds.length > 0
      ? await supabase
        .from("habit_shares")
        .select("habit_id")
        .in("habit_id", myHabitIds)
        .eq("shared_with", friendId)
      : { data: [] as { habit_id: string }[] };

  const dirAHabitIds = new Set(
    (dirAResult.data ?? []).map((s) => s.habit_id).filter((id): id is string => id != null),
  );

  // For direction B, we need to filter to habits owned by this friend
  const dirBAllIds = (dirBResult.data ?? []).map((s) => s.habit_id).filter((id): id is string => id != null);

  // 4. Fetch all candidate habit details
  const allCandidateIds = [...new Set([...dirAHabitIds, ...dirBAllIds])];

  let habits: JourneyHabit[] = [];
  const sharedHabitIds = new Set<string>();

  if (allCandidateIds.length > 0) {
    const { data: habitRows } = await supabase
      .from("habits")
      .select(
        "id, title, emoji, color, category, user_id, streak_current, streak_best, total_completions",
      )
      .in("id", allCandidateIds);

    for (const h of habitRows ?? []) {
      // Include if: direction A (my habit, in dirAHabitIds) or direction B (friend's habit)
      const isDirectionA = dirAHabitIds.has(h.id);
      const isDirectionB = h.user_id === friendId;
      if (!isDirectionA && !isDirectionB) continue;

      sharedHabitIds.add(h.id);
      habits.push({
        id: h.id,
        title: h.title,
        emoji: h.emoji ?? "✅",
        color: h.color ?? "#6366F1",
        category: h.category ?? "general",
        streak_current: h.streak_current ?? 0,
        streak_best: h.streak_best ?? 0,
        total_completions: h.total_completions ?? 0,
        owner_id: h.user_id,
        isOwner: h.user_id === user.id,
        completedToday: false, // computed after fetching completions
      });
    }
  }

  // 5. Fetch completions for shared habits (last 30 days, both users)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const habitIdArray = [...sharedHabitIds];

  // Get viewing user's timezone for accurate "completed today" check
  const { data: myProfileTz } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const userTz = myProfileTz?.timezone ?? "UTC";
  const todayLocal = new Date().toLocaleDateString("en-CA", { timeZone: userTz });

  let completions: JourneyCompletion[] = [];
  const completedTodaySet = new Set<string>();

  if (habitIdArray.length > 0) {
    const { data: compRows } = await supabase
      .from("completions")
      .select(
        "id, habit_id, user_id, completion_type, evidence_url, notes, completed_at, completed_date",
      )
      .in("habit_id", habitIdArray)
      .in("user_id", [user.id, friendId])
      .gte("completed_at", thirtyDaysAgo.toISOString())
      .order("completed_at", { ascending: false })
      .limit(500);

    const habitMap = new Map(habits.map((h) => [h.id, h]));

    for (const c of compRows ?? []) {
      if (!c.habit_id || !c.completed_at) continue;
      const habit = habitMap.get(c.habit_id);
      // Track which habits were completed today by their owner
      if (habit && c.user_id === habit.owner_id && c.completed_date === todayLocal) {
        completedTodaySet.add(c.habit_id);
      }
    }

    completions = (compRows ?? [])
      .filter((c) => c.habit_id != null && c.completed_at != null)
      .map((c) => {
        const habit = habitMap.get(c.habit_id!);
        return {
          id: c.id,
          habit_id: c.habit_id!,
          completion_type: (c.completion_type ?? "quick") as JourneyCompletion["completion_type"],
          evidence_url: c.evidence_url,
          notes: c.notes,
          completed_at: c.completed_at!,
          user_id: c.user_id,
          isMe: c.user_id === user.id,
          habit_emoji: habit?.emoji ?? "",
          habit_title: habit?.title ?? "",
          habit_color: habit?.color ?? "",
        };
      });
  }

  // Set completedToday on each habit
  habits = habits.map((h) => ({
    ...h,
    completedToday: completedTodaySet.has(h.id),
  }));

  // 6. Fetch encouragements between the two users
  const { data: encRows } = await supabase
    .from("encouragements")
    .select("id, user_id, recipient_id, encouragement_type, content, created_at, completion_id")
    .or(
      `and(user_id.eq.${user.id},recipient_id.eq.${friendId}),and(user_id.eq.${friendId},recipient_id.eq.${user.id})`,
    )
    .order("created_at", { ascending: false })
    .limit(30);

  const encouragements: JourneyEncouragement[] = (encRows ?? [])
    .filter((e) => e.created_at != null)
    .map((e) => ({
      id: e.id,
      encouragement_type: (e.encouragement_type ?? "nudge") as JourneyEncouragement["encouragement_type"],
      content: e.content,
      created_at: e.created_at!,
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
