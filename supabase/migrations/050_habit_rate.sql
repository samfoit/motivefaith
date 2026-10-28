-- ============================================================
-- 050_habit_rate.sql — a habit's rate counts the days it was due
-- ============================================================
--
-- The habit page's rate divided the days a habit was done by every day since
-- it was created. A Mon/Wed/Fri habit done every time it was due showed 43%,
-- and a weekly one done every week 14%; changing the days changed nothing
-- the rate counted.
--
-- get_habit_rate() counts what the streak counts, over the habit's life:
--
--   A day is due if it was on the schedule the habit had that day (049) and
--   was not paused (047). Done, it is due and done. A rain check that still
--   holds excuses it, and today is not counted until it is done: it is not
--   over yet. A check-in on a day off counts for nothing either way.
--
--   A week the habit was kept weekly is one due week, judged on its
--   Saturday, as its miss is told: excused if that Saturday was paused, done
--   with a check-in any day of it, excused by a rain check, and not counted
--   while it runs unless done already.
--
-- Not SECURITY DEFINER: it reads the caller's own habit, and nothing else.

CREATE OR REPLACE FUNCTION public.get_habit_rate(p_habit_id UUID)
RETURNS TABLE (due INTEGER, done INTEGER)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_habit RECORD;
  v_day DATE;
  v_week DATE;
  v_change habit_schedule_changes%ROWTYPE;
  v_frequency TEXT;
  v_days JSONB;
BEGIN
  due := 0;
  done := 0;

  SELECT h.frequency::text AS frequency,
         h.schedule->'days' AS days,
         (coalesce(h.created_at, now()) AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS first_day,
         (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
    INTO v_habit
  FROM habits h
  JOIN profiles p ON p.id = h.user_id
  WHERE h.id = p_habit_id;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_day := v_habit.first_day;
  WHILE v_day <= v_habit.today LOOP
    SELECT * INTO v_change
    FROM habit_schedule_changes sc
    WHERE sc.habit_id = p_habit_id AND sc.changed_on > v_day
    ORDER BY sc.changed_on
    LIMIT 1;

    v_frequency := CASE WHEN v_change.id IS NOT NULL THEN v_change.frequency::text ELSE v_habit.frequency END;
    v_days := CASE WHEN v_change.id IS NOT NULL THEN v_change.days ELSE v_habit.days END;

    IF v_frequency = 'weekly' THEN
      -- Each week once: on its Saturday, or today while it runs.
      IF EXTRACT(DOW FROM v_day) = 6 OR v_day = v_habit.today THEN
        v_week := v_day - EXTRACT(DOW FROM v_day)::int;
        IF habit_pause_start(p_habit_id, v_week + 6) IS NULL THEN
          IF EXISTS (
            SELECT 1 FROM completions c
            WHERE c.habit_id = p_habit_id
              AND c.completed_date BETWEEN v_week AND v_week + 6
              AND c.completion_type <> 'rain_check'
          ) THEN
            due := due + 1;
            done := done + 1;
          ELSIF EXISTS (
            SELECT 1 FROM completions c
            WHERE c.habit_id = p_habit_id
              AND c.completed_date BETWEEN v_week AND v_week + 6
              AND is_habit_day_covered(c.habit_id, c.completed_date, v_habit.today)
          ) THEN
            NULL;
          ELSIF v_week + 6 < v_habit.today THEN
            due := due + 1;
          END IF;
        END IF;
      END IF;
    ELSIF habit_pause_start(p_habit_id, v_day) IS NULL
          AND (v_days IS NULL
               OR jsonb_typeof(v_days) <> 'array'
               OR jsonb_array_length(v_days) = 0
               OR v_days @> to_jsonb(EXTRACT(DOW FROM v_day)::int)) THEN
      IF EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = p_habit_id
          AND c.completed_date = v_day
          AND c.completion_type <> 'rain_check'
      ) THEN
        due := due + 1;
        done := done + 1;
      ELSIF is_habit_day_covered(p_habit_id, v_day, v_habit.today) THEN
        NULL;
      ELSIF v_day < v_habit.today THEN
        due := due + 1;
      END IF;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_habit_rate(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_habit_rate(UUID) TO authenticated;
