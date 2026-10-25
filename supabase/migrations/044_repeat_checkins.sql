-- ============================================================
-- 044_repeat_checkins.sql — a habit can be done more than once a day
-- ============================================================
--
-- Nothing in the schema ever limited a habit to one check-in a day.
-- update_streak() (027) lets a second real check-in on the same day through
-- without moving the streak — it adds to total_completions and stops — and
-- the same for a second one in a week on a weekly habit. What did the
-- limiting was the app, which closed a habit off once it was done. It no
-- longer does: doing a habit again is logged and shared like the first time,
-- it just doesn't add to the streak.
--
-- Two readers assumed one check-in a day and catch up here:
--
--   get_habits_due_today(tz)   the capture picker's list. It left out every
--                              habit with anything logged today, so a photo
--                              could not go to a habit already done. It
--                              replaces get_incomplete_habits_today, whose
--                              name no longer fits.
--   get_habit_days_done(id)    days a habit was done on. Its rate used
--                              total_completions, which now counts a habit
--                              done twice today as two days.

-- ── 1. The capture picker's habits ──
--
-- 039's body, with three changes. Habits checked in today stay in, flagged by
-- checked_in_today and listed after the ones still to do, so the list the
-- picker used to show is still what comes first. Rain-checked ones stay in
-- too, unflagged: a real check-in after a rain check is the day's first, as
-- on the dashboard. And a habit with no days in its schedule is due every
-- day, as update_streak() and the app have always read it.

DROP FUNCTION IF EXISTS public.get_incomplete_habits_today(TEXT);

CREATE OR REPLACE FUNCTION public.get_habits_due_today(p_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  color TEXT,
  streak_current INTEGER,
  frequency habit_frequency,
  partner_ids UUID[],
  group_ids UUID[],
  private_checkins BOOLEAN,
  checked_in_today BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_dow INT;
  v_today_date DATE;
BEGIN
  v_today_dow := EXTRACT(DOW FROM now() AT TIME ZONE p_timezone)::int;
  v_today_date := (now() AT TIME ZONE p_timezone)::date;

  RETURN QUERY
  SELECT
    h.id,
    h.title,
    -- Both as stored: the dashboard shows no emoji and no tint for a
    -- habit without one, and this list must match it.
    h.emoji,
    h.color,
    coalesce(h.streak_current, 0) AS streak_current,
    h.frequency,
    habit_partner_ids(h.id),
    habit_group_ids(h.id),
    h.private_checkins,
    today.checked_in
  FROM habits h
  -- In a subquery of its own so the ORDER BY can name it: an unqualified
  -- checked_in_today there would be read as this function's OUT parameter.
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = v_today_date
        AND c.completion_type <> 'rain_check'
    ) AS checked_in
  ) today
  WHERE h.user_id = auth.uid()
    AND h.is_paused = false
    AND (
      h.schedule->'days' IS NULL
      OR jsonb_array_length(h.schedule->'days') = 0
      OR (h.schedule->'days') @> to_jsonb(v_today_dow)
      -- …or an earlier rain check promised to make it up today.
      OR EXISTS (
        SELECT 1 FROM completions rc
        WHERE rc.habit_id = h.id
          AND rc.completion_type = 'rain_check'
          AND rc.rain_check_moved_to = v_today_date
      )
    )
  ORDER BY today.checked_in, h.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_habits_due_today(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_habits_due_today(TEXT) TO authenticated;

-- ── 2. Days a habit was done on ──
--
-- As the caller, so RLS decides whose habits it can count: the owner's own,
-- and a partner's shared ones, whose check-ins they can already read row by
-- row. Anyone else counts nothing. A rain check is a skip, not a day done.
-- idx_completions_habit_date_key (001) covers the scan.

CREATE OR REPLACE FUNCTION public.get_habit_days_done(p_habit_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(DISTINCT c.completed_date)::int
  FROM completions c
  WHERE c.habit_id = p_habit_id
    AND c.completion_type <> 'rain_check';
$$;

REVOKE ALL ON FUNCTION public.get_habit_days_done(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_habit_days_done(UUID) TO authenticated;
