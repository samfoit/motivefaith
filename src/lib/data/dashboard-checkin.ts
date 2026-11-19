/**
 * A check-in made away from the dashboard — on a habit's own page, or sent
 * from the camera — written to the dashboard's cached data all the same.
 *
 * Two things depend on it. The dashboard shows the habit done the moment the
 * user goes back, rather than after its next refetch. And the day's last
 * check-in is recognised as the last wherever it is made, which is what
 * lights the lamp (`useDayKeptStore`).
 */

import type { QueryClient } from "@tanstack/react-query";
import type { DashboardData } from "@/lib/data/dashboard";
import {
  applyCompletion,
  removeCompletion,
  type OptimisticCompletion,
} from "@/lib/data/dashboard-mutations";
import { dashboardKey, fetchDashboardJson } from "@/lib/hooks/useDashboard";
import { dayKept, dayProgress, keptBy } from "@/lib/day-kept";
import { useDayKeptStore } from "@/lib/stores/day-kept-store";

/** How old the cached dashboard can be and still be taken at its word. */
const TRUSTED_FOR_MS = 60 * 1000;

export interface RecordedCheckIns {
  /** These check-ins kept the day, and the moment has been offered. */
  kept: boolean;
  /**
   * The cache was missing, or old enough that it may not know what was done
   * on another device: worth asking the server before deciding the day is
   * still open (`confirmDayKept`).
   */
  unsure: boolean;
  /** The write failed: take the check-ins back off the dashboard. */
  undo: () => void;
}

export function recordCheckIns(
  queryClient: QueryClient,
  userId: string | null | undefined,
  completions: OptimisticCompletion[],
): RecordedCheckIns {
  const key = dashboardKey(userId ?? null);
  const before = queryClient.getQueryData<DashboardData>(key);
  const fetchedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
  const unsure = !before || Date.now() - fetchedAt > TRUSTED_FOR_MS;
  if (!before || completions.length === 0) {
    return { kept: false, unsure, undo: () => {} };
  }

  // A fetch in flight would land its older copy on top of the check-in.
  void queryClient.cancelQueries({ queryKey: key });
  const after = queryClient.setQueryData<DashboardData>(key, (old) =>
    completions.reduce(applyCompletion, old),
  );

  const kept = keptBy(before, after);
  if (kept) useDayKeptStore.getState().offer(kept);

  const streaks = new Map(
    before.habits.map((h) => [h.id, h.streak_current ?? 0]),
  );
  const undo = () => {
    queryClient.setQueryData<DashboardData>(key, (old) =>
      completions.reduce(
        (data, { habitId, tempId }) =>
          removeCompletion(data, {
            habitId,
            tempId,
            streak: streaks.get(habitId) ?? 0,
          }),
        old,
      ),
    );
    void queryClient.invalidateQueries({ queryKey: key });
    if (kept) useDayKeptStore.getState().dismiss();
  };

  return { kept: !!kept, unsure, undo };
}

/**
 * Ask the server whether the day is kept, after a check-in the cache couldn't
 * vouch for has landed. The cache only knows this device: habits done this
 * morning on a laptop are news to a phone that was last opened yesterday.
 *
 * `habitIds` are the habits the check-in settled, lit last. The caller must
 * know they were open before it — a repeat check-in on a day already kept
 * would otherwise light the lamp twice.
 */
export async function confirmDayKept(
  queryClient: QueryClient,
  userId: string | null | undefined,
  habitIds: string[],
): Promise<void> {
  if (!userId || !navigator.onLine) return;
  const key = dashboardKey(userId);
  // On screen, the dashboard holds refetches off while a check-in sits in
  // its undo window, and a fetch from here would land on top of that
  // check-in. Mark it stale and leave it to the dashboard.
  const observers =
    queryClient.getQueryCache().find({ queryKey: key })?.getObserversCount() ?? 0;
  if (observers > 0) {
    void queryClient.invalidateQueries({ queryKey: key });
    return;
  }

  try {
    const fresh = await queryClient.fetchQuery({
      queryKey: key,
      queryFn: fetchDashboardJson,
      staleTime: 0,
    });
    const progress = dayProgress(fresh);
    if (!progress.kept) return;
    const settled = new Set(habitIds);
    useDayKeptStore.getState().offer(dayKept(progress, (h) => settled.has(h.id)));
  } catch {
    // No answer, no moment. The check-in itself is safe either way.
  }
}
