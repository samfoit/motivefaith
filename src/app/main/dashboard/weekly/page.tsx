import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { DEFAULT_TIMEZONE, todayDateKey } from "@/lib/utils/timezone";
import {
  dailyCounts,
  weekRangeLabel,
  weekRate,
  type WeeklyReview,
} from "@/lib/utils/weekly-review";
import { WeekStrip } from "./WeekStrip";

/** Two years of weeks; nobody scrolls further on a phone. */
const MAX_WEEKS = 104;

export default async function WeeklyReviewsPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const [{ data: profile }, { data: current }, { data: past }] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).single(),
    untypedRpc<WeeklyReview[]>(supabase, "get_current_week_review"),
    supabase
      .from("weekly_reviews")
      .select("week_start, due, done")
      .eq("user_id", user.id)
      .order("week_start", { ascending: false })
      .limit(MAX_WEEKS),
  ]);

  const today = todayDateKey(profile?.timezone ?? DEFAULT_TIMEZONE);
  const year = Number(today.slice(0, 4));
  const thisWeek = current?.[0] ?? null;
  const weeks = past ?? [];

  if (!thisWeek && weeks.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-10 text-center space-y-4">
        <p className="text-text-secondary">
          Each week&rsquo;s numbers are kept here once you have a habit to track.
        </p>
        <Link
          href="/main/habits/new"
          className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover transition-colors"
        >
          Add a habit
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-8">
      {thisWeek && <ThisWeek week={thisWeek} today={today} />}

      <section aria-labelledby="past-weeks">
        <h2 id="past-weeks" className="text-sm font-semibold text-text-secondary mb-2">
          Past weeks
        </h2>
        {weeks.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            This week is saved here when it ends, on Saturday night.
          </p>
        ) : (
          <ul className="rounded-lg bg-elevated shadow-sm divide-y divide-border">
            {weeks.map((week) => (
              <li key={week.week_start}>
                <WeekRow
                  weekStart={week.week_start}
                  label={weekRangeLabel(week.week_start, year)}
                  rate={weekRate(week)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ThisWeek({ week, today }: { week: WeeklyReview; today: string }) {
  const rate = weekRate(week);
  return (
    <section aria-labelledby="this-week">
      <h2 id="this-week" className="text-sm font-semibold text-text-secondary mb-2">
        This week so far
      </h2>
      <Link
        href={`/main/dashboard/weekly/${week.week_start}`}
        className="block rounded-lg bg-elevated p-4 shadow-sm hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <p className="font-display font-medium text-brand-ink tabular-nums" style={{ fontSize: "var(--text-2xl)" }}>
            {rate === null ? "—" : `${rate}%`}
          </p>
          <p className="text-sm text-text-secondary text-right">
            {week.due === 0
              ? "Nothing due yet"
              : `${week.done} of ${week.due} due ${week.due === 1 ? "day" : "days"} done`}
          </p>
        </div>
        <WeekStrip weekStart={week.week_start} counts={dailyCounts(week.daily_completions)} today={today} />
      </Link>
    </section>
  );
}

/**
 * A past week: its dates, and its rate as a bar, so the list reads as the
 * weeks' rates side by side.
 */
function WeekRow({ weekStart, label, rate }: { weekStart: string; label: string; rate: number | null }) {
  return (
    <Link
      href={`/main/dashboard/weekly/${weekStart}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors first:rounded-t-lg last:rounded-b-lg"
    >
      <span className="w-32 shrink-0 text-sm text-text-primary">{label}</span>
      {rate === null ? (
        <span className="flex-1 text-sm text-text-tertiary">Nothing due</span>
      ) : (
        <>
          <span aria-hidden className="flex-1 h-2 rounded-full bg-bg-secondary overflow-hidden">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${rate}%` }} />
          </span>
          <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-text-primary">
            {rate}%
          </span>
        </>
      )}
      <ChevronRight aria-hidden className="w-4 h-4 shrink-0 text-text-tertiary" />
    </Link>
  );
}
