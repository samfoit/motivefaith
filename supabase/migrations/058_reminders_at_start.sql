-- ============================================================
-- 058_reminders_at_start.sql — a habit's reminder comes when it starts, not before
-- ============================================================
--
-- A habit set for 10:00 was told "Time for …" at 9:45.
--
-- Reminders run every quarter hour and, until now, picked the habits starting
-- in the 15 minutes from the moment of the run. The edge function passes its
-- own clock, which is always a little after the quarter hour it was scheduled
-- for (pg_net's queue, the function's start-up). So the 10:00 run asked about
-- 10:00:01 to 10:15:01 and missed 10:00, which the 9:45 run had already sent.
-- The tests passed exactly 10:00:00 and never saw it.
--
-- Now:
--
--   1. the moment asked about is rounded down to its quarter hour, so a run
--      that starts late still counts as the run it was scheduled to be;
--   2. a run reminds about the habits that started in the 15 minutes up to
--      it, not after it. A habit on the quarter hour is reminded as it
--      starts; one at an exact minute (10:02) at the next quarter (10:15),
--      a few minutes into it, never before it;
--   3. the reminder's day is returned. The midnight run reminds about a habit
--      that started at 23:50 the day before, and that day, not the new one,
--      is what the edge function records in last_reminder_date, what its
--      check-in is looked for on, and whose schedule says it was due.
--
-- The return type gains reminder_date, so the function is dropped and
-- recreated, with 036's grants.

DROP FUNCTION IF EXISTS get_habits_due_for_reminder(TIMESTAMPTZ);

CREATE FUNCTION get_habits_due_for_reminder(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  user_id UUID,
  notification_prefs JSONB,
  timezone TEXT,
  reminder_date DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT h.id, h.title, h.emoji, h.user_id,
         p.notification_prefs, p.timezone, owner_day.local_day
  FROM public.habits h
  JOIN public.profiles p ON p.id = h.user_id
  -- The run this is, on the owner's clock. Every time zone is a whole number
  -- of quarter hours from UTC, so a UTC quarter hour is a local one.
  CROSS JOIN LATERAL (
    SELECT date_bin(interval '15 minutes', check_ts, timestamptz '2000-01-01 00:00+00')
             AT TIME ZONE coalesce(p.timezone, 'UTC') AS run_local
  ) run
  -- The days the last 15 minutes fall on: one, or at midnight two.
  CROSS JOIN LATERAL (
    SELECT DISTINCT d::date AS local_day
    FROM unnest(ARRAY[run.run_local::date,
                      (run.run_local - interval '15 minutes')::date]) d
  ) owner_day
  CROSS JOIN LATERAL (
    SELECT owner_day.local_day + public.habit_time(public.habit_window_on(
      h.time_window, EXTRACT(DOW FROM owner_day.local_day)::int
    )->>'start') AS starts_at
  ) day_window
  WHERE h.is_paused = false
    AND day_window.starts_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.id)
    AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
    AND (p.notification_prefs->>'habit_reminders') IS DISTINCT FROM 'false'
    -- Scheduled on its day
    AND (h.schedule->'days') @> to_jsonb(EXTRACT(DOW FROM owner_day.local_day)::int)
    -- Started in the 15 minutes up to this run
    AND day_window.starts_at >  run.run_local - interval '15 minutes'
    AND day_window.starts_at <= run.run_local
    -- Not already done that day — that week, for a weekly habit
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_date <= owner_day.local_day
        AND c.completed_date >= CASE WHEN h.frequency = 'weekly'
                                     THEN owner_day.local_day
                                          - EXTRACT(DOW FROM owner_day.local_day)::int
                                     ELSE owner_day.local_day END
    )
    -- Not already reminded that day (deduplication)
    AND (h.last_reminder_date IS NULL
      OR h.last_reminder_date < owner_day.local_day
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Only the habit-reminders edge function calls this.
REVOKE ALL ON FUNCTION get_habits_due_for_reminder(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_habits_due_for_reminder(TIMESTAMPTZ) TO service_role;
