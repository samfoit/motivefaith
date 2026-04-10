import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { InboxClient, type MissedHabitNotification } from "./inbox-client";
import InboxLoading from "./loading";
import { todayDateKey, getDayOfWeek, dayBoundsUtc, currentTimeHHMM, DEFAULT_TIMEZONE } from "@/lib/utils/timezone";

export const revalidate = 120;

export default async function InboxPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  return (
    <Suspense fallback={<InboxLoading />}>
      <InboxData userId={user.id} />
    </Suspense>
  );
}

async function InboxData({ userId }: { userId: string }) {
  const supabase = await createServerSupabase();

  const { data: profileData } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .single();

  const timeZone = profileData?.timezone || DEFAULT_TIMEZONE;
  const todayStr = todayDateKey(timeZone);
  const todayDow = getDayOfWeek(new Date(), timeZone);
  const [dayStart, dayEnd] = dayBoundsUtc(todayStr, timeZone);

  interface InboxMissedRow {
    habit_id: string;
    title: string;
    emoji: string;
    color: string;
    time_window: { start?: string; end?: string } | null;
    friend_id: string;
    friend_name: string;
    friend_avatar: string | null;
  }

  const { data, error } = await untypedRpc<InboxMissedRow[]>(
    supabase,
    "get_inbox_missed_habits",
    {
      p_user_id: userId,
      p_today_date: todayStr,
      p_day_of_week: todayDow,
      p_day_start: dayStart,
      p_day_end: dayEnd,
      p_current_time: currentTimeHHMM(timeZone),
    },
  );

  if (error) {
    console.error("get_inbox_missed_habits RPC failed:", error.message);
    return <InboxClient missedHabits={[]} />;
  }

  const missedHabits: MissedHabitNotification[] = (data ?? []).map(
    (row) => ({
      habitId: row.habit_id,
      title: row.title,
      emoji: row.emoji,
      color: row.color,
      friendId: row.friend_id,
      friendName: row.friend_name,
      friendAvatar: row.friend_avatar,
      timeWindow: row.time_window,
    }),
  );

  return <InboxClient missedHabits={missedHabits} />;
}
