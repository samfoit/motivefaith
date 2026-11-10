/**
 * The words of the push a partner gets when a habit they follow goes
 * unlogged, worded as the card in its owner's chat words it (migration 053):
 * who and which habit as a label, then where it stands. A sentence built
 * around the habit's name fits no wording for every habit ("Olive missed No
 * sugar"); a label does.
 *
 *   Olive · 🏃 Run
 *   Not logged yet. Tap to remind them.        today's window, their day not over
 *   Missed yesterday. Tap to encourage them.   a day that went by unlogged
 *
 * Kept free of imports so the app's tests can load it as well as Deno.
 */

export interface MissedPushAlert {
  title: string;
  /** A habit can have none; it is left out rather than pushed as "null". */
  emoji: string | null;
  user_name: string;
  /** The owner's local date of the day told about, as YYYY-MM-DD. */
  owner_date: string;
  /** The owner's local date when the run asked. Absent before migration 048. */
  owner_today?: string;
}

export function missedPush(alert: MissedPushAlert): { title: string; body: string } {
  const habit = alert.emoji ? `${alert.emoji} ${alert.title}` : alert.title;
  const dayOver = !!alert.owner_today && alert.owner_date < alert.owner_today;
  return {
    title: `${alert.user_name} · ${habit}`,
    body: dayOver
      ? "Missed yesterday. Tap to encourage them."
      : "Not logged yet. Tap to remind them.",
  };
}
