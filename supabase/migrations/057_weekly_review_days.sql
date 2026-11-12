-- ============================================================
-- 057_weekly_review_days.sql — the weekly review's days, where 051 left none
-- ============================================================
--
-- On the weekly review, every day said "No habits yet on this day", under a
-- strip of days that showed their check-ins.
--
-- 051 was applied to production before it was finished. The version that ran
-- there had no `days` column on weekly_reviews and no habit_day_status();
-- both were added to the file afterwards, and a migration already recorded
-- as applied is never run again. (Seen from outside on 2026-11-11: asking
-- production's API for weekly_reviews.days answers "column does not exist",
-- and it has no function by that name. Every other table, column and
-- function signature matches the migrations.) So nothing there has ever
-- worked out a day's habits: the page reads the strip from
-- daily_completions, which is there, and the list from days, which is not.
--
-- This brings such a database to where 051 ends, and is safe to run on one
-- that is already there, where every step changes nothing:
--
--   1. the column;
--   2. 051's functions, word for word. What production has of them is the
--      earlier draft, whose text cannot be read from outside, so all seven
--      are replaced rather than only the one known to be missing. Dropped
--      first, in case a draft's return type differs: nothing depends on them;
--   3. the days of weeks already saved, worked out now from the check-ins,
--      schedules and pauses kept. A saved week is otherwise never changed,
--      and its numbers are not: this fills in the one field it was saved
--      without. A week whose owner has since deleted every habit stays
--      without them;
--   4. the hourly job that saves each week, if it is missing.
--
-- It depends on nothing after 053, so it can be run on its own, ahead of
-- 054–056.

-- ── 1. The column ──

ALTER TABLE public.weekly_reviews
  ADD COLUMN IF NOT EXISTS days JSONB NOT NULL DEFAULT '{}'::jsonb;

-- As 051 leaves the table: its owner reads it, nobody writes it directly.
ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_reviews FROM anon, authenticated;
GRANT SELECT ON public.weekly_reviews TO authenticated;

-- ── 2. 051's functions, as 051 has them ──

DROP FUNCTION IF EXISTS public.get_current_week_review();
DROP FUNCTION IF EXISTS public.save_weekly_reviews();
DROP FUNCTION IF EXISTS public.save_weekly_review(UUID, DATE, BOOLEAN);
DROP FUNCTION IF EXISTS public.weekly_review_numbers(UUID, DATE, BOOLEAN);
DROP FUNCTION IF EXISTS public.get_habit_rate(UUID);
DROP FUNCTION IF EXISTS public.habit_rate_between(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.habit_day_status(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.habit_day_status(
  p_habit_id UUID,
  p_day DATE,
  p_today DATE
)
RETURNS TABLE (weekly BOOLEAN, status TEXT)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_habit RECORD;
  v_change habit_schedule_changes%ROWTYPE;
  v_frequency TEXT;
  v_days JSONB;
  v_week DATE;
  v_done BOOLEAN;
BEGIN
  SELECT h.frequency::text AS frequency,
         h.schedule->'days' AS days,
         (coalesce(h.created_at, now()) AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS first_day
    INTO v_habit
  FROM habits h
  JOIN profiles p ON p.id = h.user_id
  WHERE h.id = p_habit_id;

  IF NOT FOUND OR p_day < v_habit.first_day THEN
    RETURN;
  END IF;

  SELECT * INTO v_change
  FROM habit_schedule_changes sc
  WHERE sc.habit_id = p_habit_id AND sc.changed_on > p_day
  ORDER BY sc.changed_on
  LIMIT 1;

  v_frequency := CASE WHEN v_change.id IS NOT NULL THEN v_change.frequency::text ELSE v_habit.frequency END;
  v_days := CASE WHEN v_change.id IS NOT NULL THEN v_change.days ELSE v_habit.days END;
  weekly := v_frequency = 'weekly';

  IF p_day > p_today THEN
    status := 'upcoming';
    RETURN NEXT;
    RETURN;
  END IF;

  v_done := EXISTS (
    SELECT 1 FROM completions c
    WHERE c.habit_id = p_habit_id
      AND c.completed_date = p_day
      AND c.completion_type <> 'rain_check'
  );

  IF weekly THEN
    v_week := p_day - EXTRACT(DOW FROM p_day)::int;
    status := CASE
      WHEN habit_pause_start(p_habit_id, v_week + 6) IS NOT NULL THEN 'paused'
      WHEN v_done THEN 'done'
      WHEN EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = p_habit_id
          AND c.completed_date BETWEEN v_week AND least(v_week + 6, p_today)
          AND c.completion_type <> 'rain_check'
      ) THEN 'done_week'
      WHEN EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = p_habit_id
          AND c.completed_date BETWEEN v_week AND v_week + 6
          AND is_habit_day_covered(c.habit_id, c.completed_date, p_today)
      ) THEN 'excused'
      WHEN v_week + 6 < p_today THEN 'missed'
      ELSE 'open'
    END;
  ELSIF habit_pause_start(p_habit_id, p_day) IS NOT NULL THEN
    status := 'paused';
  ELSIF NOT (v_days IS NULL
             OR jsonb_typeof(v_days) <> 'array'
             OR jsonb_array_length(v_days) = 0
             OR v_days @> to_jsonb(EXTRACT(DOW FROM p_day)::int)) THEN
    status := CASE WHEN v_done THEN 'extra' ELSE 'off' END;
  ELSIF v_done THEN
    status := 'done';
  ELSIF is_habit_day_covered(p_habit_id, p_day, p_today) THEN
    status := 'excused';
  ELSIF p_day < p_today THEN
    status := 'missed';
  ELSE
    status := 'pending';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.habit_day_status(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.habit_day_status(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.habit_rate_between(
  p_habit_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (due INTEGER, done INTEGER)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_habit RECORD;
  v_day DATE;
  v_last DATE;
  v_day_status RECORD;
BEGIN
  due := 0;
  done := 0;

  SELECT (coalesce(h.created_at, now()) AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS first_day,
         (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
    INTO v_habit
  FROM habits h
  JOIN profiles p ON p.id = h.user_id
  WHERE h.id = p_habit_id;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_day := greatest(v_habit.first_day, coalesce(p_from, v_habit.first_day));
  v_last := least(v_habit.today, coalesce(p_to, v_habit.today));
  WHILE v_day <= v_last LOOP
    SELECT * INTO v_day_status FROM habit_day_status(p_habit_id, v_day, v_habit.today);

    -- A weekly week counts once: on its Saturday, or today while it runs.
    IF NOT v_day_status.weekly OR EXTRACT(DOW FROM v_day) = 6 OR v_day = v_habit.today THEN
      IF v_day_status.status IN ('done', 'done_week') THEN
        due := due + 1;
        done := done + 1;
      ELSIF v_day_status.status = 'missed' THEN
        due := due + 1;
      END IF;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.habit_rate_between(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.habit_rate_between(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_habit_rate(p_habit_id UUID)
RETURNS TABLE (due INTEGER, done INTEGER)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT r.due, r.done FROM habit_rate_between(p_habit_id, NULL, NULL) r;
$$;

-- 051 could leave these to 050, which it replaced the function of in place.
REVOKE ALL ON FUNCTION public.get_habit_rate(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_habit_rate(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.weekly_review_numbers(
  p_user_id UUID,
  p_week_start DATE,
  p_with_streak BOOLEAN
)
RETURNS SETOF public.weekly_reviews
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_today DATE;
  v_week_end DATE := p_week_start + 6;
  r weekly_reviews%ROWTYPE;
  v_habits INTEGER;
  v_top RECORD;
BEGIN
  IF EXTRACT(DOW FROM p_week_start) <> 0 THEN
    RAISE EXCEPTION 'A week starts on a Sunday, not %', p_week_start;
  END IF;

  SELECT coalesce(p.timezone, 'UTC') INTO v_tz FROM profiles p WHERE p.id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT count(*)::int, coalesce(sum(hr.due), 0)::int, coalesce(sum(hr.done), 0)::int
    INTO v_habits, r.due, r.done
  FROM habits h
  CROSS JOIN LATERAL habit_rate_between(h.id, p_week_start, v_week_end) hr
  WHERE h.user_id = p_user_id
    AND (coalesce(h.created_at, now()) AT TIME ZONE v_tz)::date <= v_week_end;

  IF v_habits = 0 THEN
    RETURN;
  END IF;

  SELECT coalesce(sum(d.n), 0)::int, coalesce(jsonb_object_agg(d.day, d.n), '{}'::jsonb)
    INTO r.completions, r.daily_completions
  FROM (
    SELECT c.completed_date::text AS day, count(*)::int AS n
    FROM completions c
    WHERE c.user_id = p_user_id
      AND c.completed_date BETWEEN p_week_start AND v_week_end
      AND c.completion_type <> 'rain_check'
    GROUP BY c.completed_date
  ) d;

  SELECT h.id, h.title, h.emoji, count(*)::int AS n
    INTO v_top
  FROM completions c
  JOIN habits h ON h.id = c.habit_id
  WHERE c.user_id = p_user_id
    AND c.completed_date BETWEEN p_week_start AND v_week_end
    AND c.completion_type <> 'rain_check'
  GROUP BY h.id, h.title, h.emoji
  ORDER BY n DESC, h.title
  LIMIT 1;

  SELECT coalesce(jsonb_object_agg(g.day::date::text, coalesce(dh.habits, '[]'::jsonb)), '{}'::jsonb)
    INTO r.days
  FROM generate_series(p_week_start, v_week_end, interval '1 day') AS g(day)
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'habit_id', h.id,
               'title', h.title,
               'emoji', h.emoji,
               'weekly', s.weekly,
               'status', s.status,
               'times', coalesce(t.times, '[]'::jsonb),
               'reason', rc.reason
             )
             ORDER BY h.created_at, h.title
           ) AS habits
    FROM habits h
    CROSS JOIN LATERAL habit_day_status(h.id, g.day::date, v_today) s
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_char(c.completed_at AT TIME ZONE v_tz, 'HH24:MI') ORDER BY c.completed_at) AS times
      FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = g.day::date
        AND c.completion_type <> 'rain_check'
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT c.rain_check_reason::text AS reason
      FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = g.day::date
        AND c.completion_type = 'rain_check'
      LIMIT 1
    ) rc ON true
    WHERE h.user_id = p_user_id
  ) dh ON true;

  r.top_habit_id := v_top.id;
  r.top_habit_title := v_top.title;
  r.top_habit_emoji := v_top.emoji;
  r.top_habit_count := v_top.n;

  IF p_with_streak THEN
    SELECT coalesce(max(h.streak_current), 0) INTO r.best_streak
    FROM habits h WHERE h.user_id = p_user_id;
  END IF;

  SELECT count(*) FILTER (WHERE e.user_id = p_user_id)::int,
         count(*) FILTER (WHERE e.recipient_id = p_user_id)::int
    INTO r.encouragements_sent, r.encouragements_received
  FROM encouragements e
  WHERE (e.user_id = p_user_id OR e.recipient_id = p_user_id)
    AND e.created_at >= (p_week_start::timestamp AT TIME ZONE v_tz)
    AND e.created_at < ((v_week_end + 1)::timestamp AT TIME ZONE v_tz);

  r.user_id := p_user_id;
  r.week_start := p_week_start;
  r.saved_at := now();
  RETURN NEXT r;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_weekly_review(
  p_user_id UUID,
  p_week_start DATE,
  p_with_streak BOOLEAN DEFAULT true
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
BEGIN
  IF EXTRACT(DOW FROM p_week_start) <> 0 THEN
    RAISE EXCEPTION 'A week starts on a Sunday, not %', p_week_start;
  END IF;

  SELECT coalesce(p.timezone, 'UTC') INTO v_tz FROM profiles p WHERE p.id = p_user_id;
  IF NOT FOUND OR p_week_start + 6 >= (now() AT TIME ZONE v_tz)::date THEN
    RETURN false;
  END IF;

  INSERT INTO weekly_reviews
  SELECT * FROM weekly_review_numbers(p_user_id, p_week_start, p_with_streak)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  RETURN FOUND;
END;
$$;

-- The signed-in person's week so far, counted the way a finished week is
-- saved. No row before they have a habit.
CREATE OR REPLACE FUNCTION public.get_current_week_review()
RETURNS SETOF public.weekly_reviews
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.*
  FROM profiles p
  CROSS JOIN LATERAL (
    SELECT (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
  ) t
  CROSS JOIN LATERAL weekly_review_numbers(
    p.id, t.today - EXTRACT(DOW FROM t.today)::int, true
  ) n
  WHERE p.id = auth.uid();
$$;

-- Everyone's last finished week: the one before the Sunday it is now, or was
-- last, where they are. Returns how many it saved.
CREATE OR REPLACE FUNCTION public.save_weekly_reviews()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_saved INTEGER := 0;
BEGIN
  FOR v_profile IN
    SELECT p.id, w.week_start
    FROM profiles p
    CROSS JOIN LATERAL (
      SELECT (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
    ) t
    CROSS JOIN LATERAL (
      SELECT t.today - EXTRACT(DOW FROM t.today)::int - 7 AS week_start
    ) w
    WHERE NOT EXISTS (
      SELECT 1 FROM weekly_reviews r
      WHERE r.user_id = p.id AND r.week_start = w.week_start
    )
      AND EXISTS (SELECT 1 FROM habits h WHERE h.user_id = p.id)
  LOOP
    IF save_weekly_review(v_profile.id, v_profile.week_start) THEN
      v_saved := v_saved + 1;
    END IF;
  END LOOP;

  RETURN v_saved;
END;
$$;

-- Internal: the cron job and this migration call them, as their owner.
REVOKE ALL ON FUNCTION public.weekly_review_numbers(UUID, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_weekly_review(UUID, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_weekly_reviews() FROM PUBLIC, anon, authenticated;

-- For the weekly page, its caller's own week only.
REVOKE ALL ON FUNCTION public.get_current_week_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_week_review() TO authenticated;

-- ── 3. The days of weeks saved without them ──

UPDATE public.weekly_reviews w
SET days = n.days
FROM (
  SELECT r.user_id,
         r.week_start,
         (SELECT x.days
          FROM public.weekly_review_numbers(r.user_id, r.week_start, false) x) AS days
  FROM public.weekly_reviews r
  WHERE r.days = '{}'::jsonb
) n
WHERE w.user_id = n.user_id
  AND w.week_start = n.week_start
  AND n.days IS NOT NULL;

-- ── 4. The hourly job, if a draft left it out ──

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed (local dev): save-weekly-reviews is not scheduled';
  ELSIF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'save-weekly-reviews') THEN
    PERFORM cron.schedule(
      'save-weekly-reviews',
      '5 * * * *',
      'SELECT public.save_weekly_reviews()'
    );
  END IF;
END $$;

-- The API learns of the new column.
NOTIFY pgrst, 'reload schema';
