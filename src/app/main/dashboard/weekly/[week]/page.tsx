import { notFound, redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { DEFAULT_TIMEZONE, addDays, todayDateKey } from "@/lib/utils/timezone";
import {
  dailyCounts,
  isWeekStart,
  weekDays,
  weekRangeLabel,
  weekRate,
  type WeeklyReview,
} from "@/lib/utils/weekly-review";
import { WeekDays } from "./WeekDays";

interface Props {
  params: Promise<{ week: string }>;
  searchParams: Promise<{ day?: string | string[] }>;
}

export default async function WeeklyReviewPage({ params, searchParams }: Props) {
  const [{ week: weekStart }, { day: dayParam }] = await Promise.all([params, searchParams]);
  if (!isWeekStart(weekStart)) notFound();

  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  const today = todayDateKey(profile?.timezone ?? DEFAULT_TIMEZONE);
  const running = weekStart <= today && today <= addDays(weekStart, 6);

  // The week still running is counted on the spot; a finished one is read
  // as it was saved, with the week before it to compare against.
  const [weekResult, prevResult] = await Promise.all([
    running
      ? untypedRpc<WeeklyReview[]>(supabase, "get_current_week_review")
      : supabase
          .from("weekly_reviews")
          .select("*")
          .eq("user_id", user.id)
          .eq("week_start", weekStart)
          .limit(1),
    running
      ? Promise.resolve({ data: null })
      : supabase
          .from("weekly_reviews")
          .select("completions")
          .eq("user_id", user.id)
          .eq("week_start", addDays(weekStart, -7))
          .maybeSingle(),
  ]);

  const week = weekResult.data?.[0];
  if (!week || week.week_start !== weekStart) notFound();

  // The day asked for, if it is in this week and has come; else today, while
  // the week runs.
  const asked = typeof dayParam === "string" ? dayParam : null;
  const initialDay =
    asked && weekDays(weekStart).includes(asked) && asked <= today ? asked : running ? today : null;

  const rate = weekRate(week);
  const prevCompletions = prevResult.data?.completions;
  const delta = prevCompletions === undefined ? null : week.completions - prevCompletions;

  const facts: { label: string; value: string }[] = [
    { label: "Check-ins", value: String(week.completions) },
  ];
  if (week.top_habit_title && week.top_habit_count) {
    facts.push({
      label: "Most checked in",
      value: `${week.top_habit_emoji ?? ""} ${week.top_habit_title} (${week.top_habit_count})`.trim(),
    });
  }
  if (week.best_streak !== null) {
    facts.push({
      label: running ? "Best streak" : "Best streak at week’s end",
      value: `${week.best_streak} ${week.best_streak === 1 ? "day" : "days"}`,
    });
  }
  facts.push(
    { label: "Encouragements sent", value: String(week.encouragements_sent) },
    { label: "Encouragements received", value: String(week.encouragements_received) },
  );

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
      <header>
        <h2 className="font-display font-medium text-text-primary" style={{ fontSize: "var(--text-xl)" }}>
          {weekRangeLabel(weekStart, Number(today.slice(0, 4)))}
          {running && <span className="text-text-tertiary"> so far</span>}
        </h2>
      </header>

      <section aria-label="Rate" className="space-y-1">
        <p className="font-display font-medium text-brand-ink tabular-nums leading-none" style={{ fontSize: "var(--text-hero)" }}>
          {rate === null ? "—" : `${rate}%`}
        </p>
        <p className="text-text-secondary">
          {week.due === 0
            ? running
              ? "Nothing has been due yet."
              : "Nothing was due this week."
            : `${week.done} of ${week.due} due ${week.due === 1 ? "day" : "days"} done`}
        </p>
        {delta !== null && delta !== 0 && (
          <p className="text-sm" style={{ color: delta > 0 ? "var(--color-success)" : "var(--color-miss)" }}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)} {delta > 0 ? "more" : "fewer"} check-ins than the week before
          </p>
        )}
      </section>

      <WeekDays
        weekStart={weekStart}
        counts={dailyCounts(week.daily_completions)}
        days={week.days}
        today={running ? today : undefined}
        initialDay={initialDay}
      />

      <dl className="rounded-lg bg-elevated shadow-sm divide-y divide-border">
        {facts.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-text-secondary">{label}</dt>
            <dd className="text-sm font-medium text-text-primary text-right tabular-nums min-w-0 truncate">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
