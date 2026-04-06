-- ============================================================
-- 012_fix_streak_custom_schedules.sql
-- Fix streak calculation for:
--   1. Custom daily schedules (e.g. every day except Friday) —
--      streaks broke when the gap between completions spanned
--      non-scheduled days.
--   2. Weekly habits — were treated like daily, requiring a
--      completion every day instead of once per week.
--   3. Same-day duplicate completions — second completion on the
--      same date would reset streak to 1.
--   4. Off-day completions — completing on a non-scheduled day
--      poisoned prev_completion and broke the next scheduled day.
-- ============================================================

-- ── update_streak: schedule-aware + frequency-aware ──

CREATE OR REPLACE FUNCTION update_streak()
RETURNS TRIGGER AS $$
DECLARE
  prev_completion   DATE;
  cur_streak        INT;
  sched_days        JSONB;
  freq              TEXT;
  check_date        DATE;
  check_dow         INT;
  expected_prev     DATE := NULL;
  week_start        DATE;
  prev_week_start   DATE;
  already_counted   BOOLEAN;
BEGIN
  SELECT streak_current, schedule->'days', frequency::text
    INTO cur_streak, sched_days, freq
    FROM public.habits
    WHERE id = NEW.habit_id
    FOR UPDATE;

  SELECT MAX(c.completed_date) INTO prev_completion
    FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date < NEW.completed_date;

  -- ── Weekly frequency: streak = consecutive weeks with a completion ──
  IF freq = 'weekly' THEN
    -- Week starts on Sunday (DOW 0)
    week_start := NEW.completed_date - EXTRACT(DOW FROM NEW.completed_date)::int;
    prev_week_start := week_start - 7;

    -- Check if this week already had a completion before this one
    SELECT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = NEW.habit_id
        AND c.completed_date >= week_start
        AND c.id != NEW.id
    ) INTO already_counted;

    IF already_counted THEN
      -- Duplicate this week: just bump total, don't change streak
      UPDATE public.habits SET
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    ELSIF prev_completion IS NOT NULL
          AND prev_completion >= prev_week_start THEN
      -- Previous completion was last week: streak continues
      UPDATE public.habits SET
        streak_current    = cur_streak + 1,
        streak_best       = GREATEST(streak_best, cur_streak + 1),
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    ELSE
      -- No completion last week: start new streak
      UPDATE public.habits SET
        streak_current    = 1,
        streak_best       = GREATEST(streak_best, 1),
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    END IF;

    RETURN NEW;
  END IF;

  -- ── Daily-type frequencies ──

  -- Guard: if this date already has another completion, just bump total.
  -- Prevents duplicate same-day completions from resetting the streak.
  SELECT EXISTS (
    SELECT 1 FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date = NEW.completed_date
      AND c.id != NEW.id
  ) INTO already_counted;

  IF already_counted THEN
    UPDATE public.habits SET
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
    RETURN NEW;
  END IF;

  -- Walk backward from the day before this completion to find
  -- the most recent scheduled day (up to 14 days back).
  check_date := NEW.completed_date - 1;
  FOR i IN 1..14 LOOP
    check_dow := EXTRACT(DOW FROM check_date)::int;

    IF sched_days IS NULL
       OR jsonb_array_length(sched_days) = 0
       OR sched_days @> to_jsonb(check_dow) THEN
      expected_prev := check_date;
      EXIT;
    END IF;

    check_date := check_date - 1;
  END LOOP;

  -- Use >= so that completions on non-scheduled (off) days between
  -- two scheduled days don't break the streak. E.g. a Mon-Fri habit
  -- completed on Saturday: on Monday, prev_completion = Saturday,
  -- expected_prev = Friday. Saturday >= Friday → streak continues.
  IF prev_completion IS NOT NULL
     AND expected_prev IS NOT NULL
     AND prev_completion >= expected_prev THEN
    UPDATE public.habits SET
      streak_current    = cur_streak + 1,
      streak_best       = GREATEST(streak_best, cur_streak + 1),
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
  ELSE
    UPDATE public.habits SET
      streak_current    = 1,
      streak_best       = GREATEST(streak_best, 1),
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql SET search_path = public;

-- ── reset_stale_streaks: schedule-aware + frequency-aware ──

CREATE OR REPLACE FUNCTION public.reset_stale_streaks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  -- ── Reset daily-type habits (daily, weekdays, weekends, specific_days) ──
  WITH stale_daily AS (
    SELECT h.id AS habit_id
    FROM habits h
    JOIN profiles p ON p.id = h.user_id
    CROSS JOIN LATERAL (
      -- Find the most recent scheduled day before today (up to 14 days back).
      SELECT d::date AS last_sched
      FROM generate_series(
        (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date - 1,
        (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date - 14,
        '-1 day'::interval
      ) AS d
      WHERE (
        h.schedule->'days' IS NULL
        OR jsonb_array_length(h.schedule->'days') = 0
        OR (h.schedule->'days') @> to_jsonb(EXTRACT(DOW FROM d)::int)
      )
      ORDER BY d DESC
      LIMIT 1
    ) ls
    WHERE h.streak_current > 0
      AND h.is_paused = false
      AND h.frequency != 'weekly'
      AND NOT EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = h.id
          AND c.completed_date = ls.last_sched
      )
  )
  UPDATE habits
  SET streak_current = 0
  FROM stale_daily
  WHERE habits.id = stale_daily.habit_id;

  -- ── Reset weekly habits with no completion in current or previous week ──
  WITH stale_weekly AS (
    SELECT h.id AS habit_id
    FROM habits h
    JOIN profiles p ON p.id = h.user_id
    WHERE h.streak_current > 0
      AND h.is_paused = false
      AND h.frequency = 'weekly'
      AND NOT EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = h.id
          AND c.completed_date >= (
            -- Start of previous week (Sunday)
            (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date
            - EXTRACT(DOW FROM now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::int
            - 7
          )
      )
  )
  UPDATE habits
  SET streak_current = 0
  FROM stale_weekly
  WHERE habits.id = stale_weekly.habit_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
