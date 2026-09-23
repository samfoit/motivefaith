-- =============================================================================
-- Rain check semantics tests
-- =============================================================================
-- Run against a local Supabase instance:
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/rain-check.test.sql
--
-- A rain check is a deliberate skip. It must HOLD the streak: the day counts
-- as covered, but streak_current, streak_best and total_completions never move.
-- These tests pin that behavior down in update_streak(), reset_stale_streaks()
-- and get_missed_habit_count().
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Setup: one owner (dana) and one partner (evan)
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'dana@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now()
);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'evan@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now()
);

UPDATE public.profiles SET display_name = 'Dana', username = 'dana', timezone = 'UTC'
  WHERE id = '44444444-4444-4444-4444-444444444444';
UPDATE public.profiles SET display_name = 'Evan', username = 'evan', timezone = 'UTC'
  WHERE id = '55555555-5555-5555-5555-555555555555';

-- Four daily habits, one per scenario. Default schedule covers every weekday.
INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule)
VALUES
  ('bbbb0001-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Hold Test',   '🌧', 'daily', '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('bbbb0002-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Bridge Test', '🌉', 'daily', '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('bbbb0003-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Same Day',    '🌓', 'daily', '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('bbbb0004-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Stale Test',  '🧹', 'daily', '{"days":[0,1,2,3,4,5,6]}'::jsonb);

-- ---------------------------------------------------------------------------
-- Test 1: a rain check moves nothing
-- ---------------------------------------------------------------------------

INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('bbbb0001-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'rain_check', 'sick', now());

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, streak_best, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0001-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 0,    'TEST 1 FAILED: rain check advanced streak_current to ' || h.streak_current;
  ASSERT h.streak_best = 0,       'TEST 1 FAILED: rain check advanced streak_best to ' || h.streak_best;
  ASSERT h.total_completions = 0, 'TEST 1 FAILED: rain check counted as a completion (' || h.total_completions || ')';
  RAISE NOTICE 'TEST 1 PASSED: a rain check leaves streak and totals untouched';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a rain check bridges the gap — streak 5 -> rain check -> 6, not 7
-- ---------------------------------------------------------------------------

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'bbbb0002-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'quick',
       (now()::date - d)::timestamptz + interval '12 hours'
FROM generate_series(6, 2, -1) AS d;

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0002-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 5,    'TEST 2 SETUP FAILED: expected streak 5, got ' || h.streak_current;
  ASSERT h.total_completions = 5, 'TEST 2 SETUP FAILED: expected 5 completions, got ' || h.total_completions;
END $$;

-- Yesterday: rain check
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('bbbb0002-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'rain_check', 'travel',
        (now()::date - 1)::timestamptz + interval '12 hours');

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0002-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 5,    'TEST 2a FAILED: rain check changed streak to ' || h.streak_current;
  ASSERT h.total_completions = 5, 'TEST 2a FAILED: rain check bumped total to ' || h.total_completions;
  RAISE NOTICE 'TEST 2a PASSED: rain check holds the streak at 5';
END $$;

-- Today: a real completion continues across the rain-checked day
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0002-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'quick', now());

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, streak_best, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0002-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 6,    'TEST 2b FAILED: expected streak 6 after bridge, got ' || h.streak_current;
  ASSERT h.streak_best = 6,       'TEST 2b FAILED: expected best 6, got ' || h.streak_best;
  ASSERT h.total_completions = 6, 'TEST 2b FAILED: expected 6 completions, got ' || h.total_completions;
  RAISE NOTICE 'TEST 2b PASSED: streak bridges a rain-checked day (6, not 7)';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: rain check in the morning, real check-in the same evening
-- The same-day "already counted" guard must ignore rain-check rows, or the
-- genuine completion becomes a no-op for the streak.
-- ---------------------------------------------------------------------------

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0003-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'quick',
        (now()::date - 1)::timestamptz + interval '12 hours');

INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('bbbb0003-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'rain_check', 'busy',
        now()::date::timestamptz + interval '8 hours');

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0003-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'quick',
        now()::date::timestamptz + interval '20 hours');

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0003-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 2,    'TEST 3 FAILED: expected streak 2 after changing your mind, got ' || h.streak_current;
  ASSERT h.total_completions = 2, 'TEST 3 FAILED: expected 2 completions, got ' || h.total_completions;
  RAISE NOTICE 'TEST 3 PASSED: a real check-in after a same-day rain check still advances the streak';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: the constraint rejects a reason on a non-rain-check row
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason)
    VALUES ('bbbb0001-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'quick', 'sick');
    ASSERT false, 'TEST 4 FAILED: a quick completion was allowed to carry a rain_check_reason';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 4 PASSED: chk_rain_check_reason rejects a reason on a non-rain-check row';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: a rain check suppresses the partner's "missed habit" count
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_now_time TEXT := to_char(now() AT TIME ZONE 'UTC', 'HH24:MI');
  v_count INT;
BEGIN
  IF v_now_time < '00:10' THEN
    RAISE NOTICE 'TEST 5 SKIPPED: too close to midnight UTC for a passed time window';
    RETURN;
  END IF;

  -- A habit with an accepted partner, whose time window has already closed
  -- today. Since 029 it is the accepted share — not a boolean on the habit —
  -- that makes it eligible for a miss alert.
  UPDATE public.habits
    SET time_window = jsonb_build_object('start', '00:00', 'end', '00:05')
    WHERE id = 'bbbb0004-0000-0000-0000-000000000000';

  INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by)
  VALUES ('bbbb0004-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'accepted', '44444444-4444-4444-4444-444444444444');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);

  SELECT public.get_missed_habit_count('UTC') INTO v_count;
  ASSERT v_count = 1, 'TEST 5 SETUP FAILED: expected 1 missed habit, got ' || v_count;

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
  VALUES ('bbbb0004-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'rain_check', 'rest', now());

  PERFORM set_config('role', 'authenticated', true);
  SELECT public.get_missed_habit_count('UTC') INTO v_count;
  ASSERT v_count = 0, 'TEST 5 FAILED: rain-checked habit still counted as missed (' || v_count || ')';

  PERFORM set_config('role', 'postgres', true);
  RAISE NOTICE 'TEST 5 PASSED: a rain check clears the partner-facing missed count';
END $$;

RESET role;

-- ---------------------------------------------------------------------------
-- Test 6: reset_stale_streaks respects a rain check on the last scheduled day,
-- but still collects the streak the day after.
-- ---------------------------------------------------------------------------

UPDATE public.habits
  SET streak_current = 5, streak_best = 5, time_window = NULL
  WHERE id = 'bbbb0004-0000-0000-0000-000000000000';

DELETE FROM public.habit_shares WHERE habit_id = 'bbbb0004-0000-0000-0000-000000000000';

DELETE FROM public.completions WHERE habit_id = 'bbbb0004-0000-0000-0000-000000000000';

-- Yesterday only: a rain check
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('bbbb0004-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'rain_check', 'sick',
        (now()::date - 1)::timestamptz + interval '12 hours');

-- update_streak must not have moved it off 5
UPDATE public.habits SET streak_current = 5 WHERE id = 'bbbb0004-0000-0000-0000-000000000000';

DO $$
DECLARE v_streak INT;
BEGIN
  PERFORM public.reset_stale_streaks();
  SELECT streak_current INTO v_streak
    FROM public.habits WHERE id = 'bbbb0004-0000-0000-0000-000000000000';
  ASSERT v_streak = 5, 'TEST 6a FAILED: yesterday''s rain check did not protect the streak (got ' || v_streak || ')';
  RAISE NOTICE 'TEST 6a PASSED: reset_stale_streaks treats a rain-checked day as covered';
END $$;

-- Move the rain check back a day: yesterday is now uncovered
UPDATE public.completions
  SET completed_at = (now()::date - 2)::timestamptz + interval '12 hours'
  WHERE habit_id = 'bbbb0004-0000-0000-0000-000000000000';

DO $$
DECLARE v_streak INT;
BEGIN
  PERFORM public.reset_stale_streaks();
  SELECT streak_current INTO v_streak
    FROM public.habits WHERE id = 'bbbb0004-0000-0000-0000-000000000000';
  ASSERT v_streak = 0, 'TEST 6b FAILED: streak survived an uncovered day (got ' || v_streak || ')';
  RAISE NOTICE 'TEST 6b PASSED: a rain check only covers its own day';
END $$;

-- ---------------------------------------------------------------------------
-- Moved rain checks (migration 027)
--
-- A rain check can name a day to make the habit up on. That turns the skip
-- into a promise: the day stays covered while the promise is pending or once
-- it has been kept, and stops being covered the moment the chosen day passes
-- undone.
--
-- The habits below are given a schedule with YESTERDAY's and TOMORROW's
-- weekdays removed. Yesterday, so that "the last scheduled day before today"
-- is the day before yesterday whatever day the suite happens to run on, and
-- so a promise can legally land on yesterday. Tomorrow, so a promise can land
-- there too — since 028, a move may only target a day the habit is free on.
-- ---------------------------------------------------------------------------

INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule)
VALUES
  ('bbbb0005-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Move Kept',  '↪', 'specific_days', '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('bbbb0006-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Move Lapsed','↪', 'specific_days', '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'Move Bounds','↪', 'specific_days', '{"days":[0,1,2,3,4,5,6]}'::jsonb);

-- Drop yesterday's and tomorrow's weekdays from the scheduled habits.
UPDATE public.habits
  SET schedule = jsonb_build_object('days', (
    SELECT jsonb_agg(d ORDER BY d)
    FROM generate_series(0, 6) AS d
    WHERE d <> ((EXTRACT(DOW FROM now())::int + 6) % 7)
      AND d <> ((EXTRACT(DOW FROM now())::int + 1) % 7)
  ))
  WHERE id IN (
    'bbbb0005-0000-0000-0000-000000000000',
    'bbbb0006-0000-0000-0000-000000000000',
    'bbbb0007-0000-0000-0000-000000000000'
  );

-- ---------------------------------------------------------------------------
-- Test 7: chk_rain_check_moved_to bounds the promise
-- ---------------------------------------------------------------------------

DO $$
DECLARE rejected BOOLEAN;
BEGIN
  -- Backwards: you cannot move a rain check into the past.
  rejected := false;
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_moved_to, completed_at)
    VALUES ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
            'rain_check', now()::date - 1, now());
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected, 'TEST 7a FAILED: a backwards move was accepted';

  -- Same day is not a move either.
  rejected := false;
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_moved_to, completed_at)
    VALUES ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
            'rain_check', now()::date, now());
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected, 'TEST 7b FAILED: a move to the same day was accepted';

  -- Beyond the 14-day walk-back both streak paths use.
  rejected := false;
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_moved_to, completed_at)
    VALUES ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
            'rain_check', now()::date + 15, now());
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected, 'TEST 7c FAILED: a move 15 days out was accepted';

  -- A moved-to day only means anything on a rain check.
  rejected := false;
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_moved_to, completed_at)
    VALUES ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
            'quick', now()::date + 1, now());
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected, 'TEST 7d FAILED: a moved-to day on a real completion was accepted';

  RAISE NOTICE 'TEST 7 PASSED: chk_rain_check_moved_to rejects backwards, same-day, far-out and non-rain-check moves';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: a moved rain check is still a rain check — it moves nothing
-- ---------------------------------------------------------------------------

DELETE FROM public.completions WHERE habit_id = 'bbbb0007-0000-0000-0000-000000000000';

INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, rain_check_moved_to, completed_at)
VALUES ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'rain_check', 'busy', now()::date + 1, now());

DO $$
DECLARE h RECORD; v_moved DATE;
BEGIN
  SELECT streak_current, streak_best, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0007-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 0,    'TEST 8 FAILED: a moved rain check advanced streak_current';
  ASSERT h.streak_best = 0,       'TEST 8 FAILED: a moved rain check advanced streak_best';
  ASSERT h.total_completions = 0, 'TEST 8 FAILED: a moved rain check counted as a completion';

  SELECT rain_check_moved_to INTO v_moved
    FROM public.completions WHERE habit_id = 'bbbb0007-0000-0000-0000-000000000000';
  ASSERT v_moved = now()::date + 1, 'TEST 8 FAILED: the promised day was not stored';

  -- A pending promise covers its own day.
  ASSERT public.is_habit_day_covered(
           'bbbb0007-0000-0000-0000-000000000000', now()::date, now()::date),
         'TEST 8 FAILED: a pending promise left its own day uncovered';

  RAISE NOTICE 'TEST 8 PASSED: a moved rain check stores its day and still moves no counters';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9: promise kept — the makeup advances the streak, and the day it was
-- moved from stays covered afterwards
-- ---------------------------------------------------------------------------

-- A completion three days back (a scheduled day), then a rain check the day
-- before yesterday moved onto yesterday (which is off-schedule).
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0005-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'quick', (now()::date - 3)::timestamptz + interval '12 hours');

INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, rain_check_moved_to, completed_at)
VALUES ('bbbb0005-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'rain_check', 'travel', now()::date - 1, (now()::date - 2)::timestamptz + interval '12 hours');

UPDATE public.habits SET streak_current = 4, streak_best = 4, total_completions = 4
  WHERE id = 'bbbb0005-0000-0000-0000-000000000000';

-- The makeup itself, on the promised (off-schedule) day.
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0005-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'quick', (now()::date - 1)::timestamptz + interval '12 hours');

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, streak_best, total_completions INTO h
    FROM public.habits WHERE id = 'bbbb0005-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 5,
    'TEST 9a FAILED: the makeup did not advance the streak (got ' || h.streak_current || ', wanted 5)';
  ASSERT h.total_completions = 5,
    'TEST 9a FAILED: the makeup was not counted (got ' || h.total_completions || ')';

  ASSERT public.is_habit_day_covered(
           'bbbb0005-0000-0000-0000-000000000000', now()::date - 2, now()::date),
         'TEST 9b FAILED: a kept promise left the day it moved from uncovered';

  PERFORM public.reset_stale_streaks();
  SELECT streak_current INTO h FROM public.habits
    WHERE id = 'bbbb0005-0000-0000-0000-000000000000';
  ASSERT h.streak_current = 5,
    'TEST 9c FAILED: reset_stale_streaks collected a streak held by a kept promise (got ' || h.streak_current || ')';

  RAISE NOTICE 'TEST 9 PASSED: a kept promise advances the streak and keeps the moved-from day covered';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10: promise broken — the day it moved from stops being covered, and
-- the streak breaks
-- ---------------------------------------------------------------------------

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0006-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'quick', (now()::date - 3)::timestamptz + interval '12 hours');

-- Same shape as test 9, but yesterday passes with nothing on it.
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, rain_check_moved_to, completed_at)
VALUES ('bbbb0006-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'rain_check', 'busy', now()::date - 1, (now()::date - 2)::timestamptz + interval '12 hours');

UPDATE public.habits SET streak_current = 4, streak_best = 4, total_completions = 4
  WHERE id = 'bbbb0006-0000-0000-0000-000000000000';

DO $$
DECLARE v_streak INT;
BEGIN
  ASSERT NOT public.is_habit_day_covered(
           'bbbb0006-0000-0000-0000-000000000000', now()::date - 2, now()::date),
         'TEST 10a FAILED: a broken promise still covered the day it moved from';

  PERFORM public.reset_stale_streaks();
  SELECT streak_current INTO v_streak FROM public.habits
    WHERE id = 'bbbb0006-0000-0000-0000-000000000000';
  ASSERT v_streak = 0,
    'TEST 10b FAILED: the streak survived a broken promise (got ' || v_streak || ')';
  RAISE NOTICE 'TEST 10 PASSED: a broken promise uncovers its day and reset_stale_streaks collects the streak';
END $$;

-- A completion today now starts over rather than continuing the old chain:
-- the last scheduled day before today is still the uncovered one.
UPDATE public.habits SET streak_current = 4 WHERE id = 'bbbb0006-0000-0000-0000-000000000000';

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('bbbb0006-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'quick', now());

DO $$
DECLARE v_streak INT;
BEGIN
  SELECT streak_current INTO v_streak FROM public.habits
    WHERE id = 'bbbb0006-0000-0000-0000-000000000000';
  ASSERT v_streak = 1,
    'TEST 10c FAILED: update_streak bridged a broken promise (got ' || v_streak || ', wanted 1)';
  RAISE NOTICE 'TEST 10c PASSED: update_streak will not bridge a broken promise';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11: a promise that is not due yet still protects the streak
-- ---------------------------------------------------------------------------

DELETE FROM public.completions WHERE habit_id = 'bbbb0005-0000-0000-0000-000000000000';

-- Rain-checked the day before yesterday, promised for tomorrow. Yesterday is
-- off-schedule, so the last scheduled day before today is the rain-checked one.
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, rain_check_moved_to, completed_at)
VALUES ('bbbb0005-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
        'rain_check', 'sick', now()::date + 1, (now()::date - 2)::timestamptz + interval '12 hours');

UPDATE public.habits SET streak_current = 4 WHERE id = 'bbbb0005-0000-0000-0000-000000000000';

DO $$
DECLARE v_streak INT;
BEGIN
  PERFORM public.reset_stale_streaks();
  SELECT streak_current INTO v_streak FROM public.habits
    WHERE id = 'bbbb0005-0000-0000-0000-000000000000';
  ASSERT v_streak = 4,
    'TEST 11 FAILED: a pending promise did not protect the streak (got ' || v_streak || ')';
  RAISE NOTICE 'TEST 11 PASSED: a promise that is not due yet still holds the streak';
END $$;

-- ---------------------------------------------------------------------------
-- Test 12: a move may only land on a day the habit is free (migration 028)
-- ---------------------------------------------------------------------------

DO $$
DECLARE rejected BOOLEAN; sched_day INT; target DATE;
BEGIN
  -- Find a day in the next week that bbbb0007 IS scheduled for.
  SELECT d::date INTO target
  FROM generate_series(now()::date + 1, now()::date + 7, '1 day'::interval) AS d
  WHERE (SELECT schedule->'days' FROM public.habits
         WHERE id = 'bbbb0007-0000-0000-0000-000000000000')
        @> to_jsonb(EXTRACT(DOW FROM d)::int)
  LIMIT 1;
  ASSERT target IS NOT NULL, 'TEST 12 SETUP FAILED: no scheduled day in the next week';

  rejected := false;
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_moved_to, completed_at)
    VALUES ('bbbb0007-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
            'rain_check', target, now());
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected,
    'TEST 12a FAILED: a move onto an already-scheduled day was accepted (' || target || ')';

  -- bbbb0001 is scheduled every day, so it has nowhere at all to move to.
  rejected := false;
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_moved_to, completed_at)
    VALUES ('bbbb0001-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
            'rain_check', now()::date + 1, now());
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected, 'TEST 12b FAILED: a daily habit was allowed to move a rain check';

  -- A plain skip on that same daily habit is still fine.
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('bbbb0001-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444',
          'rain_check', now() - interval '1 second');

  RAISE NOTICE 'TEST 12 PASSED: a move must land on a free day, and a daily habit can only be skipped';
END $$;

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ALL RAIN CHECK TESTS PASSED ===';
END $$;

ROLLBACK;
