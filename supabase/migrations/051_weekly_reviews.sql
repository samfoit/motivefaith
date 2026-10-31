-- ============================================================
-- 051_weekly_reviews.sql — each week's numbers, kept
-- ============================================================
--
-- The weekly summary was worked out on the spot: the Sunday push counted the
-- last seven days, and the page it opened counted them again, live, whenever
-- it was opened. Nothing was kept, so there was no last week to look back on,
-- and an old week counted again would drift as habits were edited, paused or
-- deleted.
--
-- Each finished week is now saved once, the way the app counts a week:
-- Sunday to Saturday, in the owner's timezone.
--
--   weekly_reviews           one row per person per week, read by its owner
--                            and written only by save_weekly_review().
--   habit_day_status()       what a day was for a habit: done, missed,
--                            excused, paused, off its schedule...
--   habit_rate_between()     get_habit_rate()'s count, over any span of days,
--                            from those days.
--                            get_habit_rate() is now the span from the habit's
--                            first day to today, so the habit page and the
--                            week count due days alike: by the schedule each
--                            day had (049), leaving out paused days (047) and
--                            days a rain check excused.
--   weekly_review_numbers()  works out one person's week, finished or not.
--   save_weekly_review()     saves one person's finished week.
--   get_current_week_review() the signed-in person's week so far, for the
--                            weekly page, counted the way it will be saved.
--   save_weekly_reviews()    saves everyone's last finished week. Run hourly,
--                            so each week is saved in the first hour of its
--                            owner's Sunday, well before the 18:00 push reads
--                            it.
--
-- Past weeks are saved now too, up to a year back, from the check-ins kept.
-- Their best streak is left empty: what it was then is not kept anywhere.

-- ── 1. The reviews ──

CREATE TABLE public.weekly_reviews (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The week's Sunday, in the owner's timezone.
  week_start DATE NOT NULL,
  -- Days due and done, summed over the habits: what the rate divides.
  due INTEGER NOT NULL,
  done INTEGER NOT NULL,
  -- Check-ins, a habit done twice in a day counting twice. Rain checks are
  -- not check-ins.
  completions INTEGER NOT NULL,
  -- Check-ins per day, {"2026-10-18": 3, ...}, for the heatmap.
  daily_completions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Each day's habits and what became of them, kept as they were:
  -- {"2026-10-18": [{"habit_id", "title", "emoji", "weekly", "status",
  -- "times": ["06:45"], "reason"}, ...], ...}. Statuses are
  -- habit_day_status()'s; times are check-ins, in the owner's timezone;
  -- reason is a rain check's, on the day it was taken.
  days JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The habit checked in on most. Its title and emoji are kept as they were,
  -- so the week still reads right once the habit is renamed or deleted.
  top_habit_id UUID REFERENCES public.habits(id) ON DELETE SET NULL,
  top_habit_title TEXT,
  top_habit_emoji TEXT,
  top_habit_count INTEGER,
  -- The longest current streak when the week was saved. Empty for a week
  -- saved after the fact.
  best_streak INTEGER,
  encouragements_sent INTEGER NOT NULL,
  encouragements_received INTEGER NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start),
  CONSTRAINT chk_weekly_review_sunday CHECK (EXTRACT(DOW FROM week_start) = 0),
  CONSTRAINT chk_weekly_review_done CHECK (done BETWEEN 0 AND due)
);

ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;

-- The owner reads them. No write policy: only save_weekly_review() writes.
CREATE POLICY "Own weekly reviews select"
  ON public.weekly_reviews FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.weekly_reviews FROM anon, authenticated;
GRANT SELECT ON public.weekly_reviews TO authenticated;

-- ── 2. A habit's day, and its rate over a span of days ──
--
-- habit_day_status() says what one day was for a habit, by the rules
-- get_habit_rate() always counted by: the schedule the habit had that day
-- (049), its pauses (047), and rain checks that still hold. Not counted
-- before the habit existed (NULL), nor after p_today ('upcoming').
--
--   A day kept by days of the week (weekly = false):
--     paused     the habit was paused that day
--     off        not on the schedule that day
--     extra      not on the schedule, checked in anyway: counts for nothing
--     done       due and done
--     excused    due, and a rain check excused it
--     missed     due, and over without being done
--     pending    due today, not done yet
--
--   A day of a week kept weekly (weekly = true), told of the whole week:
--     paused     its Saturday was paused, so the week is excused
--     done       checked in on this day
--     done_week  checked in on another day of the week
--     excused    a rain check excused the week
--     missed     the week is over, and it was not done
--     open       the week is still running, and it is not done yet
--
-- habit_rate_between() counts those days: a day due and done, or due and
-- missed; a weekly week once, on its Saturday or on today while it runs. It
-- is get_habit_rate()'s count over any span: from p_from, or the habit's
-- first day if later, to p_to, or today if sooner. NULL bounds mean the
-- habit's whole life.
--
-- Not SECURITY DEFINER: called by a signed-in user, they read their own
-- habit, and nothing else.

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

-- ── 3. A week's numbers ──
--
-- Works out one person's week as a weekly_reviews row, without saving it:
-- days due and done, check-ins, each day's habits, the habit checked in on
-- most, the best streak (when asked for) and encouragements. A week still running is counted up to
-- now, today waiting until it is done, as the habit page counts it. No row if
-- the person had no habit by the week's Saturday.
--
-- Internal: it answers for anyone it is given. save_weekly_review() and
-- get_current_week_review() call it as its owner.

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

-- ── 4. Saving a week ──
--
-- Saves nothing if the week is not over yet, if the person had no habit by
-- its Saturday, or if it is saved already: a saved week is never changed.
-- Returns whether it saved one.

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

-- ── 5. Hourly, a few minutes past ──

DO $$
BEGIN
  PERFORM cron.schedule(
    'save-weekly-reviews',
    '5 * * * *',
    'SELECT public.save_weekly_reviews()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available (local dev) — skipping save-weekly-reviews: %', SQLERRM;
END $$;

-- ── 6. The weeks before ──
--
-- Every finished week since each person's first habit, a year back at most.

DO $$
DECLARE
  v_profile RECORD;
  v_week DATE;
BEGIN
  FOR v_profile IN
    SELECT p.id,
           (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today,
           (min(h.created_at) AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS first_day
    FROM profiles p
    JOIN habits h ON h.user_id = p.id
    GROUP BY p.id, p.timezone
  LOOP
    v_week := greatest(
      v_profile.first_day - EXTRACT(DOW FROM v_profile.first_day)::int,
      v_profile.today - EXTRACT(DOW FROM v_profile.today)::int - 52 * 7
    );
    WHILE v_week + 6 < v_profile.today LOOP
      PERFORM public.save_weekly_review(v_profile.id, v_week, false);
      v_week := v_week + 7;
    END LOOP;
  END LOOP;
END $$;
