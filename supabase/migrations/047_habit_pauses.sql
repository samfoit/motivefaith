-- ============================================================
-- 047_habit_pauses.sql — a paused habit keeps its streak, and
-- takes no check-ins
-- ============================================================
--
-- Pausing promised to keep the streak, but is_paused only ever said a habit
-- was paused now, never when. reset_stale_streaks() passed a paused habit
-- over, so the number lasted through the pause — and once it was resumed,
-- every reader of the streak took the paused days for misses. The next
-- hourly sweep zeroed it, and a check-in before that started over at 1. The
-- habit page showed 0 sooner still, from the first scheduled day paused.
--
-- Each pause is now kept as a span of days, and the streak steps over one the
-- way it steps over a day off the schedule:
--
--   habit_pauses             one row per pause: the first day paused, and
--                            the first day back once it is resumed. Written
--                            only by the trigger on habits.is_paused, so a
--                            pause is kept however the flag is set.
--   habit_last_due_day()     the last day before a date that a habit was
--                            due: on its schedule, and not paused.
--   habit_last_counted_week() the same for a weekly habit's weeks.
--
-- update_streak() and reset_stale_streaks() ask those two instead of walking
-- the calendar themselves. computeEffectiveStreak() in
-- src/lib/utils/streak.ts mirrors both; keep them in step.
--
-- Which days a pause covers. A day is judged when it ends, so a day is
-- paused if the habit was paused at its end: from the day it was paused, up
-- to but not including the day it was resumed. Resuming means it is tracked
-- again from that day on. A day already done when the habit is paused is not
-- taken into the pause — it stays a done day — and a pause that is resumed
-- the same day covers nothing. A weekly habit's week is excused when its
-- Saturday was paused, the day a miss would be told to its partners.
--
-- A paused habit also takes no check-ins. The app never offered one, but
-- nothing refused it either: a second device's cached dashboard, or a
-- check-in queued offline and sent after the pause, landed like any other,
-- moving the streak and pushing "completed" to partners. insert_completion()
-- now refuses it, and with it insert_private_completion() and
-- share_capture(), which go through it; so does the insert policy. The
-- offline batch drops one instead: it is a single transaction, and its queue
-- retries every failure but a 400, so refusing one paused habit would hold
-- back everything queued with it.

-- ── 1. The pauses ──

CREATE TABLE public.habit_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id UUID NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  -- Days in the owner's timezone: the first one paused, and the first one
  -- back. Open while ended_on is null.
  started_on DATE NOT NULL,
  ended_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_habit_pause_span CHECK (ended_on IS NULL OR ended_on > started_on)
);

-- One open pause per habit. The trigger's ON CONFLICT names this index.
CREATE UNIQUE INDEX idx_habit_pauses_open
  ON public.habit_pauses (habit_id) WHERE ended_on IS NULL;

CREATE INDEX idx_habit_pauses_habit
  ON public.habit_pauses (habit_id, started_on);

ALTER TABLE public.habit_pauses ENABLE ROW LEVEL SECURITY;

-- The owner reads them, for the streak and rate the app works out itself.
-- No write policy: only record_habit_pause() writes here.
CREATE POLICY "Own habit pauses select"
  ON public.habit_pauses FOR SELECT TO authenticated
  USING (public.is_habit_owner(habit_id));

REVOKE ALL ON public.habit_pauses FROM anon, authenticated;
GRANT SELECT ON public.habit_pauses TO authenticated;

-- ── 2. Keeping them ──

CREATE OR REPLACE FUNCTION public.record_habit_pause()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was BOOLEAN := false;
  v_now BOOLEAN := coalesce(NEW.is_paused, false);
  v_today DATE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_was := coalesce(OLD.is_paused, false);
  END IF;

  IF v_was = v_now THEN
    RETURN NULL;
  END IF;

  SELECT (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date INTO v_today
  FROM profiles p
  WHERE p.id = NEW.user_id;
  v_today := coalesce(v_today, (now() AT TIME ZONE 'UTC')::date);

  IF v_now THEN
    -- Done today, today stays done: the pause starts tomorrow.
    INSERT INTO habit_pauses (habit_id, started_on)
    VALUES (
      NEW.id,
      v_today + CASE WHEN EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = NEW.id
          AND c.completed_date = v_today
          AND c.completion_type <> 'rain_check'
      ) THEN 1 ELSE 0 END
    )
    ON CONFLICT (habit_id) WHERE ended_on IS NULL DO NOTHING;
  ELSE
    -- Back today, so today is tracked again. A pause that never reached the
    -- end of a day covered nothing, and goes.
    DELETE FROM habit_pauses
    WHERE habit_id = NEW.id
      AND ended_on IS NULL
      AND started_on >= v_today;

    UPDATE habit_pauses SET ended_on = v_today
    WHERE habit_id = NEW.id AND ended_on IS NULL;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_habit_pause() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_record_habit_pause
  AFTER INSERT OR UPDATE OF is_paused ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.record_habit_pause();

-- A habit paused before now never recorded when. Take the day after its last
-- check-in: a streak still standing was standing then, and one that had
-- lapsed was zeroed by the sweep before the pause, so nothing that ended is
-- brought back.
INSERT INTO public.habit_pauses (habit_id, started_on)
SELECT h.id,
       LEAST(
         t.today + 1,
         coalesce(
           (SELECT max(c.completed_date) + 1
            FROM public.completions c
            WHERE c.habit_id = h.id),
           (h.created_at AT TIME ZONE t.tz)::date
         )
       )
FROM public.habits h
LEFT JOIN public.profiles p ON p.id = h.user_id
CROSS JOIN LATERAL (
  SELECT coalesce(p.timezone, 'UTC') AS tz,
         (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today
) t
WHERE coalesce(h.is_paused, false)
ON CONFLICT (habit_id) WHERE ended_on IS NULL DO NOTHING;

-- ── 3. Stepping over them ──
--
-- Not SECURITY DEFINER, and signed-in users keep them: update_streak() runs
-- as whoever inserted the check-in, which is a signed-in user when it goes
-- straight into the table. They read habit_pauses as the caller, so they
-- answer only about the caller's own habits.

-- The first day of the pause covering a day, or NULL if none does.
CREATE OR REPLACE FUNCTION public.habit_pause_start(p_habit_id UUID, p_day DATE)
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT min(hp.started_on)
  FROM habit_pauses hp
  WHERE hp.habit_id = p_habit_id
    AND hp.started_on <= p_day
    AND (hp.ended_on IS NULL OR hp.ended_on > p_day);
$$;

-- The last day before p_before that the habit was due: on its schedule, and
-- not paused. A pause is stepped over whole, however long it ran; only days
-- off the schedule count toward giving up, after the same 14 that
-- update_streak() and reset_stale_streaks() always searched.
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
BEGIN
  FOR i IN 1..14 LOOP
    LOOP
      v_pause_start := habit_pause_start(p_habit_id, v_day);
      EXIT WHEN v_pause_start IS NULL;
      v_day := v_pause_start - 1;
    END LOOP;

    IF p_days IS NULL
       OR jsonb_array_length(p_days) = 0
       OR p_days @> to_jsonb(EXTRACT(DOW FROM v_day)::int) THEN
      RETURN v_day;
    END IF;

    v_day := v_day - 1;
  END LOOP;

  RETURN NULL;
END;
$$;

-- The Sunday of the last week before p_week_start that a weekly habit was
-- held to: one whose Saturday was not paused.
CREATE OR REPLACE FUNCTION public.habit_last_counted_week(
  p_habit_id   UUID,
  p_week_start DATE
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_week DATE := p_week_start - 7;
  v_pause_start DATE;
BEGIN
  LOOP
    v_pause_start := habit_pause_start(p_habit_id, v_week + 6);
    IF v_pause_start IS NULL THEN
      RETURN v_week;
    END IF;
    -- That Saturday was paused, and so was every one back to the week the
    -- pause began in.
    v_week := v_pause_start - EXTRACT(DOW FROM v_pause_start)::int - 7;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.habit_pause_start(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.habit_last_due_day(UUID, JSONB, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.habit_last_counted_week(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.habit_pause_start(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.habit_last_due_day(UUID, JSONB, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.habit_last_counted_week(UUID, DATE) TO authenticated;

-- ── 4. update_streak: the day before can be the far side of a pause ──
-- Body reproduced from 027. The day — or week — before is now asked of
-- habit_last_due_day() and habit_last_counted_week(), and the look for a
-- covered day reaches back to it, however far that is, where it used to stop
-- at 30 days. With no pauses both come out exactly as before.

CREATE OR REPLACE FUNCTION update_streak()
RETURNS TRIGGER AS $$
DECLARE
  cur_streak        INT;
  sched_days        JSONB;
  freq              TEXT;
  expected_prev     DATE;
  week_start        DATE;
  prev_week_start   DATE;
  already_counted   BOOLEAN;
BEGIN
  -- A rain check preserves the streak by existing, and changes nothing else.
  IF NEW.completion_type = 'rain_check' THEN
    RETURN NEW;
  END IF;

  SELECT streak_current, schedule->'days', frequency::text
    INTO cur_streak, sched_days, freq
    FROM public.habits
    WHERE id = NEW.habit_id
    FOR UPDATE;

  -- ── Weekly frequency: streak = consecutive weeks with a completion ──
  IF freq = 'weekly' THEN
    -- Week starts on Sunday (DOW 0)
    week_start := NEW.completed_date - EXTRACT(DOW FROM NEW.completed_date)::int;
    -- Last week, unless it was paused away — then the one before the pause.
    prev_week_start := public.habit_last_counted_week(NEW.habit_id, week_start);

    -- Check if this week already had a real completion before this one
    SELECT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = NEW.habit_id
        AND c.completed_date >= week_start
        AND c.completion_type <> 'rain_check'
        AND c.id != NEW.id
    ) INTO already_counted;

    IF already_counted THEN
      -- Duplicate this week: just bump total, don't change streak
      UPDATE public.habits SET
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    ELSIF EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = NEW.habit_id
        AND c.completed_date >= prev_week_start
        AND c.completed_date < NEW.completed_date
        AND public.is_habit_day_covered(
              c.habit_id, c.completed_date, NEW.completed_date)
    ) THEN
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

  -- Guard: if this date already has another real completion, just bump total.
  -- Prevents duplicate same-day completions from resetting the streak.
  -- Rain checks are excluded so that rain-checking in the morning and then
  -- actually doing the habit in the evening still advances the streak.
  SELECT EXISTS (
    SELECT 1 FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date = NEW.completed_date
      AND c.completion_type <> 'rain_check'
      AND c.id != NEW.id
  ) INTO already_counted;

  IF already_counted THEN
    UPDATE public.habits SET
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
    RETURN NEW;
  END IF;

  -- The most recent day it was due before this one: scheduled, and not
  -- paused (up to 14 days back, not counting a pause).
  expected_prev := public.habit_last_due_day(
    NEW.habit_id, sched_days, NEW.completed_date);

  -- Any covered day from then on, so that completions on non-scheduled (off)
  -- days between two scheduled days don't break the streak. E.g. a Mon-Fri
  -- habit completed on Saturday: on Monday, expected_prev = Friday, and
  -- Saturday counts → streak continues.
  IF expected_prev IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date >= expected_prev
      AND c.completed_date < NEW.completed_date
      AND public.is_habit_day_covered(
            c.habit_id, c.completed_date, NEW.completed_date)
  ) THEN
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

-- ── 5. reset_stale_streaks: a paused day is not a missed one ──
-- Body reproduced from 027. Both CTEs ask the helpers above for the day — or
-- week — to judge, instead of walking back from today themselves.

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
      -- The most recent day it was due before today: scheduled, and not
      -- paused (up to 14 days back, not counting a pause).
      SELECT habit_last_due_day(h.id, h.schedule->'days', t.today) AS last_sched
    ) ls
    WHERE h.streak_current > 0
      AND h.is_paused = false
      AND h.frequency != 'weekly'
      AND ls.last_sched IS NOT NULL
      AND NOT is_habit_day_covered(h.id, ls.last_sched, t.today)
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

-- ── 6. insert_completion: not while paused ──
-- Body reproduced from 027, with the paused check folded into the ownership
-- one. insert_private_completion() and share_capture() refuse through it.
-- 55000 is object_not_in_prerequisite_state: resuming is the prerequisite.

CREATE OR REPLACE FUNCTION insert_completion(
  p_habit_id UUID,
  p_completion_type completion_type,
  p_evidence_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_rain_check_reason rain_check_reason DEFAULT NULL,
  p_rain_check_moved_to DATE DEFAULT NULL
)
RETURNS completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion completions;
  v_recent_count INTEGER;
  v_reason rain_check_reason;
  v_moved_to DATE;
  v_paused BOOLEAN;
BEGIN
  SELECT count(*)::int INTO v_recent_count
  FROM completions
  WHERE user_id = auth.uid()
    AND completed_at > now() - interval '60 seconds';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded'
      USING ERRCODE = '54000';
  END IF;

  SELECT coalesce(is_paused, false) INTO v_paused
  FROM habits
  WHERE id = p_habit_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Habit not found or not owned'
      USING ERRCODE = '42501';
  END IF;

  IF v_paused THEN
    RAISE EXCEPTION 'Habit is paused'
      USING ERRCODE = '55000';
  END IF;

  -- Ignore a reason or a moved-to day sent alongside a non-rain-check type
  -- rather than letting a malformed client trip the CHECK constraints.
  v_reason   := CASE WHEN p_completion_type = 'rain_check'
                     THEN p_rain_check_reason
                     ELSE NULL END;
  v_moved_to := CASE WHEN p_completion_type = 'rain_check'
                     THEN p_rain_check_moved_to
                     ELSE NULL END;

  INSERT INTO completions (
    habit_id, user_id, completion_type, evidence_url, notes,
    rain_check_reason, rain_check_moved_to
  )
  VALUES (
    p_habit_id, auth.uid(), p_completion_type, p_evidence_url, p_notes,
    v_reason, v_moved_to
  )
  RETURNING * INTO v_completion;

  RETURN v_completion;
END;
$$;

-- ── 7. insert_completions_batch: a paused habit's are dropped ──
-- Body reproduced from 039. Only the offline queue sends here, so a habit can
-- have been paused since its check-in was queued. That check-in is left out
-- rather than refused, so the rest of the batch still lands.

CREATE OR REPLACE FUNCTION insert_completions_batch(
  p_items JSONB
)
RETURNS SETOF completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item RECORD;
  v_bad_id UUID;
  v_paused UUID[];
  v_completion completions;
  v_evidence TEXT;
  v_notes TEXT;
BEGIN
  SELECT (item->>'habit_id')::UUID INTO v_bad_id
  FROM jsonb_array_elements(p_items) AS item
  WHERE NOT EXISTS (
    SELECT 1 FROM habits h
    WHERE h.id = (item->>'habit_id')::UUID AND h.user_id = v_uid
  )
  LIMIT 1;

  IF v_bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'Habit % not found or not owned', v_bad_id
      USING ERRCODE = '42501';
  END IF;

  v_paused := ARRAY(
    SELECT h.id FROM habits h
    WHERE h.user_id = v_uid
      AND coalesce(h.is_paused, false)
      AND h.id IN (
        SELECT (item->>'habit_id')::UUID FROM jsonb_array_elements(p_items) AS item
      )
  );

  FOR v_item IN
    SELECT
      (item->>'habit_id')::UUID AS habit_id,
      (item->>'completion_type')::completion_type AS completion_type,
      nullif(item->>'evidence_url', '') AS evidence_url,
      nullif(btrim(coalesce(item->>'notes', '')), '') AS notes,
      coalesce((item->>'is_private')::boolean, false) AS is_private,
      CASE WHEN (item->>'completion_type')::completion_type = 'rain_check'
           THEN NULLIF(item->>'rain_check_reason', '')::rain_check_reason
           ELSE NULL END AS rain_check_reason,
      CASE WHEN (item->>'completion_type')::completion_type = 'rain_check'
           THEN NULLIF(item->>'rain_check_moved_to', '')::date
           ELSE NULL END AS rain_check_moved_to
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(item, ord)
    ORDER BY ord
  LOOP
    CONTINUE WHEN v_item.habit_id = ANY(v_paused);

    IF v_item.is_private
       AND v_item.completion_type IN ('photo', 'video', 'voice', 'message') THEN
      v_evidence := v_item.evidence_url;
      v_notes := v_item.notes;

      IF v_evidence IS NOT NULL
         AND (split_part(v_evidence, '/', 1) != v_uid::text
              OR split_part(v_evidence, '/', 2) != 'private') THEN
        RAISE EXCEPTION 'Private media must be in your private folder'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO completions (habit_id, user_id, completion_type)
      VALUES (v_item.habit_id, v_uid, 'quick')
      RETURNING * INTO v_completion;

      IF v_evidence IS NOT NULL OR v_notes IS NOT NULL THEN
        INSERT INTO completion_private_content (
          completion_id, user_id, completion_type, evidence_url, notes
        )
        VALUES (v_completion.id, v_uid, v_item.completion_type, v_evidence, v_notes);
      END IF;
    ELSE
      INSERT INTO completions (
        habit_id, user_id, completion_type, evidence_url, notes,
        rain_check_reason, rain_check_moved_to
      )
      VALUES (
        v_item.habit_id, v_uid, v_item.completion_type,
        v_item.evidence_url, v_item.notes,
        v_item.rain_check_reason, v_item.rain_check_moved_to
      )
      RETURNING * INTO v_completion;
    END IF;

    RETURN NEXT v_completion;
  END LOOP;
END;
$$;

-- ── 8. Nor straight into the table ──

ALTER POLICY "Own completions insert" ON public.completions
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.habits
      WHERE habits.id = completions.habit_id
        AND habits.user_id = auth.uid()
        AND NOT coalesce(habits.is_paused, false)
    )
  );
