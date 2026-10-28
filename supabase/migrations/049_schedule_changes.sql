-- ============================================================
-- 049_schedule_changes.sql — past days keep the schedule they had
-- ============================================================
--
-- The streak judged every day by the schedule a habit has now. A Mon/Wed/Fri
-- habit made daily on a Sunday had Saturday judged as a day it was due and
-- missed: the next hourly sweep zeroed the streak, and a check-in before
-- that started over at 1. The week and month views drew Saturday as missed
-- too, and a day taken off the schedule stopped showing as missed.
--
-- Switching between weekly and a daily kind keeps the number — a 10-day
-- streak becomes a 10-week one, as decided — but the streak itself didn't
-- survive the switch. A weekly habit made daily on Sunday had Saturday judged
-- as a daily day, missed, and the next sweep zeroed it. The other way round,
-- a daily habit made weekly the morning after a miss, before the sweep came
-- round, kept the streak the miss had ended: the weekly sweep only looks for
-- a check-in in the last two weeks.
--
-- Each change is now kept with the schedule it replaced:
--
--   habit_schedule_changes   one row per day a habit's schedule changed: the
--                            day, and the frequency and days before it.
--                            Written only by a trigger on habits.
--
-- A day is judged by the schedule the habit had at its end, as a pause is
-- (047): the day of a change by the new schedule, every day before by the
-- old. habit_last_due_day() reads each day's schedule as it steps back.
--
-- Stepping back into a stretch the habit kept weekly, it stops at that
-- stretch's last two weeks — the ones a weekly streak hung on when the change
-- came — and returns the latest day in them that kept it, or their first day
-- if none did. So a weekly habit made daily keeps its streak until the first
-- day it is due under the new schedule, and loses it if that day is missed.
--
-- The other way, there is nothing to step back into: a weekly streak is read
-- from check-ins, not days. So the switch to weekly asks whether the streak
-- still stood under the old schedule, and ends it there if not, as the sweep
-- would have.
--
-- And the hourly sweep never asked whether today was done. After a miss, the
-- first sweep zeroed the streak and a check-in started it over at 1 — and
-- every sweep after that zeroed it again, yesterday still being missed, so
-- the next day's check-in made it 1 where it should have been 2. The app
-- already counted a streak done today as standing; the sweep now does too.
--
-- computeEffectiveStreak() in src/lib/utils/streak.ts and the week and month
-- views mirror the walk; keep them in step.

-- ── 1. The changes ──

CREATE TABLE public.habit_schedule_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id UUID NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  -- The owner's day the new schedule took effect. It and every day after are
  -- judged by the newer schedule; every day before by this row's.
  changed_on DATE NOT NULL,
  -- The schedule before the change, as habits keeps it.
  frequency habit_frequency NOT NULL,
  days JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A second change the same day keeps the first one's: the schedule in
  -- between held no day to its end.
  CONSTRAINT habit_schedule_changes_one_a_day UNIQUE (habit_id, changed_on)
);

ALTER TABLE public.habit_schedule_changes ENABLE ROW LEVEL SECURITY;

-- The owner reads them, for the streak and the views the app works out
-- itself. No write policy: only record_schedule_change() writes here.
CREATE POLICY "Own habit schedule changes select"
  ON public.habit_schedule_changes FOR SELECT TO authenticated
  USING (public.is_habit_owner(habit_id));

REVOKE ALL ON public.habit_schedule_changes FROM anon, authenticated;
GRANT SELECT ON public.habit_schedule_changes TO authenticated;

-- ── 2. The schedule on a day, and the day before a check-in ──
--
-- Like 047's helpers: not SECURITY DEFINER, so they read the caller's own
-- habits, and update_streak() runs them as whoever checked in.

-- For a habit that was weekly until p_until: the latest day, up to and on it
-- but before p_before, that kept the weekly streak — a covered day in its
-- week or the week it was held to before — or, if none did, the first day of
-- those weeks. p_before is the day being asked about, so a check-in on the
-- day of the change is not taken for the day before itself.
CREATE OR REPLACE FUNCTION public.habit_weekly_stand(
  p_habit_id UUID,
  p_until    DATE,
  p_before   DATE
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_since DATE := habit_last_counted_week(
    p_habit_id, p_until - EXTRACT(DOW FROM p_until)::int);
BEGIN
  RETURN coalesce(
    (SELECT max(c.completed_date)
     FROM completions c
     WHERE c.habit_id = p_habit_id
       AND c.completed_date >= v_since
       AND c.completed_date <= p_until
       AND c.completed_date < p_before
       AND is_habit_day_covered(c.habit_id, c.completed_date, p_until)),
    v_since);
END;
$$;

-- 047's walk, reading each day's own schedule: the one the first change after
-- it replaced, or p_days, today's. The last day before p_before the habit was
-- due — or, stepping into a weekly stretch, the day habit_weekly_stand()
-- finds there.
CREATE OR REPLACE FUNCTION public.habit_last_due_day(
  p_habit_id UUID,
  p_days     JSONB,
  p_before   DATE
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_day DATE := p_before - 1;
  v_pause_start DATE;
  v_change habit_schedule_changes%ROWTYPE;
  v_days JSONB;
BEGIN
  FOR i IN 1..14 LOOP
    LOOP
      v_pause_start := habit_pause_start(p_habit_id, v_day);
      EXIT WHEN v_pause_start IS NULL;
      v_day := v_pause_start - 1;
    END LOOP;

    SELECT * INTO v_change
    FROM habit_schedule_changes sc
    WHERE sc.habit_id = p_habit_id AND sc.changed_on > v_day
    ORDER BY sc.changed_on
    LIMIT 1;

    IF v_change.id IS NOT NULL AND v_change.frequency = 'weekly' THEN
      RETURN habit_weekly_stand(p_habit_id, v_change.changed_on, p_before);
    END IF;

    v_days := CASE WHEN v_change.id IS NOT NULL THEN v_change.days ELSE p_days END;

    IF v_days IS NULL
       OR jsonb_typeof(v_days) <> 'array'
       OR jsonb_array_length(v_days) = 0
       OR v_days @> to_jsonb(EXTRACT(DOW FROM v_day)::int) THEN
      RETURN v_day;
    END IF;

    v_day := v_day - 1;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.habit_weekly_stand(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.habit_weekly_stand(UUID, DATE, DATE) TO authenticated;

-- ── 3. Keeping them ──

CREATE OR REPLACE FUNCTION public.record_schedule_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE;
  v_last DATE;
BEGIN
  IF NEW.frequency IS NOT DISTINCT FROM OLD.frequency
     AND same_days(NEW.schedule->'days', OLD.schedule->'days') THEN
    RETURN NEW;
  END IF;

  SELECT (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date INTO v_today
  FROM profiles p
  WHERE p.id = NEW.user_id;
  v_today := coalesce(v_today, (now() AT TIME ZONE 'UTC')::date);

  -- Made weekly: did the streak still stand under the schedule it had? Asked
  -- before this change is kept, so the walk reads the old schedule.
  IF NEW.frequency = 'weekly' AND OLD.frequency <> 'weekly'
     AND coalesce(NEW.streak_current, 0) > 0
     AND NOT is_habit_day_covered(NEW.id, v_today, v_today) THEN
    v_last := habit_last_due_day(NEW.id, OLD.schedule->'days', v_today);
    IF v_last IS NOT NULL AND NOT is_habit_day_covered(NEW.id, v_last, v_today) THEN
      NEW.streak_current := 0;
    END IF;
  END IF;

  INSERT INTO habit_schedule_changes (habit_id, changed_on, frequency, days)
  VALUES (NEW.id, v_today, OLD.frequency, OLD.schedule->'days')
  ON CONFLICT (habit_id, changed_on) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_schedule_change() FROM PUBLIC, anon, authenticated;

-- Between habits_normalize_time_window and habits_timing_changed: triggers of
-- a kind fire in name order.
DROP TRIGGER IF EXISTS habits_schedule_history ON public.habits;
CREATE TRIGGER habits_schedule_history
  BEFORE UPDATE OF schedule, frequency ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.record_schedule_change();

-- ── 4. The sweep leaves a streak done today alone ──
-- 047's body. A daily habit is judged by its last day due before today, as
-- before, but not once today is done: update_streak() judged the day before
-- when today's check-in came, and its number stands until tomorrow's sweep.

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
      SELECT (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
    ) t
    CROSS JOIN LATERAL (
      -- The most recent day it was due before today: on the schedule it had
      -- then, and not paused (up to 14 days back, not counting a pause).
      SELECT habit_last_due_day(h.id, h.schedule->'days', t.today) AS last_sched
    ) ls
    WHERE h.streak_current > 0
      AND h.is_paused = false
      AND h.frequency != 'weekly'
      AND ls.last_sched IS NOT NULL
      AND NOT is_habit_day_covered(h.id, ls.last_sched, t.today)
      AND NOT is_habit_day_covered(h.id, t.today, t.today)
  )
  UPDATE habits
  SET streak_current = 0
  FROM stale_daily
  WHERE habits.id = stale_daily.habit_id;

  -- ── Reset weekly habits with no covered day in current or previous week ──
  -- The previous week being the last one it was held to: a week whose
  -- Saturday was paused is stepped over.
  WITH stale_weekly AS (
    SELECT h.id AS habit_id
    FROM habits h
    JOIN profiles p ON p.id = h.user_id
    CROSS JOIN LATERAL (
      SELECT (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
    ) t
    CROSS JOIN LATERAL (
      SELECT habit_last_counted_week(
               h.id, t.today - EXTRACT(DOW FROM t.today)::int
             ) AS since
    ) lw
    WHERE h.streak_current > 0
      AND h.is_paused = false
      AND h.frequency = 'weekly'
      AND NOT EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = h.id
          AND c.completed_date >= lw.since
          AND is_habit_day_covered(c.habit_id, c.completed_date, t.today)
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
