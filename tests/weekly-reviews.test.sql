-- =============================================================================
-- Each week's numbers, kept (migration 051)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/weekly-reviews.test.sql
--
-- save_weekly_review() saves a finished Sunday-to-Saturday week once: days due
-- and done as get_habit_rate() counts them, check-ins, the habit checked in on
-- most, and encouragements. save_weekly_reviews() saves everyone's last one.
-- Only the owner reads them, and nobody but those two writes them.
--
-- It reads the real clock, so "last week" is the Sunday-to-Saturday before
-- the real one, whatever day it is. pg_net is not installed on a local stack,
-- so `net` is stubbed for the notify triggers. Everything is rolled back at
-- the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Weekly habits stand here for ones kept weekly before 052, whose weeks are
-- still judged as weekly. 052 refuses new ones; this rolls back with the rest.
ALTER TABLE public.habits DROP CONSTRAINT IF EXISTS chk_habit_not_weekly;

CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(
  url TEXT,
  body JSONB DEFAULT '{}'::jsonb,
  params JSONB DEFAULT '{}'::jsonb,
  headers JSONB DEFAULT '{}'::jsonb,
  timeout_milliseconds INT DEFAULT 5000
) RETURNS BIGINT
LANGUAGE sql AS $fn$ SELECT 1::bigint $fn$;

-- Last week's Sunday, and a day of it at noon.
CREATE FUNCTION public._w() RETURNS DATE
LANGUAGE sql AS $fn$
  SELECT (now() AT TIME ZONE 'UTC')::date - EXTRACT(DOW FROM (now() AT TIME ZONE 'UTC')::date)::int - 7
$fn$;

CREATE FUNCTION public._at(p_day DATE) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $fn$ SELECT (p_day + time '12:00') AT TIME ZONE 'UTC' $fn$;

CREATE FUNCTION public._done(p_habit UUID, p_day DATE) RETURNS VOID
LANGUAGE sql AS $fn$
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES (p_habit, 'c0000000-0000-4000-8000-000000000001', 'quick', public._at(p_day))
$fn$;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wr-ada@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"wr_ada"}'::jsonb,  now(), now()),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wr-ben@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"wr_ben"}'::jsonb,  now(), now()),
  ('c0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wr-cy@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"wr_cy"}'::jsonb,   now(), now());

UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003');

-- Ada, all created the week before last:
--   Daily    done Sun, Mon, Tue twice and Thu; rain-checked Fri
--   Weekly   done Wed
--   Paused   paused the whole of last week
--   New      created today, after the week
-- Ben's only habit is new. Cy has none.
INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule, created_at) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Daily',  '🏃', 'daily',  '{"days":[0,1,2,3,4,5,6]}', public._at(public._w() - 7)),
  ('c1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Weekly', '🧹', 'weekly', '{"days":[0,1,2,3,4,5,6]}', public._at(public._w() - 7)),
  ('c1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Paused', '📖', 'daily',  '{"days":[0,1,2,3,4,5,6]}', public._at(public._w() - 7)),
  ('c1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'New',    '🌱', 'daily',  '{"days":[0,1,2,3,4,5,6]}', now()),
  ('c1000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 'Ben''s', '🌱', 'daily',  '{"days":[0,1,2,3,4,5,6]}', now());

SELECT public._done('c1000000-0000-4000-8000-000000000001', public._w());
SELECT public._done('c1000000-0000-4000-8000-000000000001', public._w() + 1);
SELECT public._done('c1000000-0000-4000-8000-000000000001', public._w() + 2);
SELECT public._done('c1000000-0000-4000-8000-000000000001', public._w() + 2);
SELECT public._done('c1000000-0000-4000-8000-000000000001', public._w() + 4);
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'rain_check', 'rest', public._at(public._w() + 5));
SELECT public._done('c1000000-0000-4000-8000-000000000002', public._w() + 3);
INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('c1000000-0000-4000-8000-000000000003', public._w(), public._w() + 7);

-- Two sent last week and one the week before; one received last week.
INSERT INTO public.encouragements (user_id, recipient_id, content, created_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'go', public._at(public._w() + 1)),
  ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'go', public._at(public._w() + 6)),
  ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'go', public._at(public._w() - 1)),
  ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'go', public._at(public._w() + 3));

-- ---------------------------------------------------------------------------
-- Test 1: the hourly run saves everyone's last week, once
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_saved INT;
  r public.weekly_reviews%ROWTYPE;
BEGIN
  v_saved := public.save_weekly_reviews();
  ASSERT v_saved = 1, format('TEST 1a FAILED: only Ada had a habit last week, saved %s', v_saved);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.weekly_reviews
    WHERE user_id IN ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003')
  ), 'TEST 1a FAILED: a week with no habit in it was saved';
  RAISE NOTICE 'TEST 1a PASSED: last week is saved for the one person who had a habit in it';

  SELECT * INTO r FROM public.weekly_reviews
  WHERE user_id = 'c0000000-0000-4000-8000-000000000001' AND week_start = public._w();

  -- Daily: 7 days, Fri excused, 4 done. Weekly: 1 of 1. Paused: none. New: not yet.
  ASSERT r.due = 7 AND r.done = 5,
    format('TEST 1b FAILED: should be 7 due and 5 done, got %s/%s', r.due, r.done);
  RAISE NOTICE 'TEST 1b PASSED: days due and done are counted as the habit page counts them';

  ASSERT r.completions = 6,
    format('TEST 1c FAILED: six check-ins, the rain check left out, got %s', r.completions);
  ASSERT r.daily_completions = jsonb_build_object(
      public._w()::text, 1, (public._w() + 1)::text, 1, (public._w() + 2)::text, 2,
      (public._w() + 3)::text, 1, (public._w() + 4)::text, 1),
    format('TEST 1c FAILED: check-ins per day, got %s', r.daily_completions);
  RAISE NOTICE 'TEST 1c PASSED: check-ins are counted each time, per day, without the rain check';

  ASSERT r.top_habit_id = 'c1000000-0000-4000-8000-000000000001'
     AND r.top_habit_title = 'Daily' AND r.top_habit_emoji = '🏃' AND r.top_habit_count = 5,
    format('TEST 1d FAILED: Daily, with 5, should be the top habit, got %s %s', r.top_habit_title, r.top_habit_count);
  RAISE NOTICE 'TEST 1d PASSED: the habit checked in on most is kept with its title and emoji';

  ASSERT r.encouragements_sent = 2 AND r.encouragements_received = 1,
    format('TEST 1e FAILED: 2 sent and 1 received, got %s/%s', r.encouragements_sent, r.encouragements_received);
  RAISE NOTICE 'TEST 1e PASSED: encouragements are counted within the week';

  ASSERT r.best_streak = (SELECT max(streak_current) FROM public.habits
                          WHERE user_id = 'c0000000-0000-4000-8000-000000000001'),
    format('TEST 1f FAILED: best streak should be the longest current one, got %s', r.best_streak);
  RAISE NOTICE 'TEST 1f PASSED: the best streak is kept as it is when the week is saved';

  v_saved := public.save_weekly_reviews();
  ASSERT v_saved = 0, format('TEST 1g FAILED: the next run should save nothing, saved %s', v_saved);
  RAISE NOTICE 'TEST 1g PASSED: the next hourly run saves nothing again';
END $$;

-- "title:status" for each habit on a day of last week's saved review.
CREATE FUNCTION public._day(p_offset INT) RETURNS TEXT
LANGUAGE sql AS $fn$
  SELECT string_agg((e->>'title') || ':' || (e->>'status'), ' ' ORDER BY e->>'title')
  FROM public.weekly_reviews w,
       jsonb_array_elements(w.days -> (public._w() + p_offset)::text) e
  WHERE w.user_id = 'c0000000-0000-4000-8000-000000000001' AND w.week_start = public._w()
$fn$;

DO $$
DECLARE
  v_days JSONB;
BEGIN
  ASSERT public._day(0) = 'Daily:done Paused:paused Weekly:done_week',
    format('TEST 1h FAILED: Sunday, got %s', public._day(0));
  ASSERT public._day(3) = 'Daily:missed Paused:paused Weekly:done',
    format('TEST 1h FAILED: Wednesday, got %s', public._day(3));
  ASSERT public._day(5) = 'Daily:excused Paused:paused Weekly:done_week',
    format('TEST 1h FAILED: Friday, got %s', public._day(5));
  RAISE NOTICE 'TEST 1h PASSED: each day keeps each habit''s status, and New, made after, is left out';

  SELECT days INTO v_days FROM public.weekly_reviews
  WHERE user_id = 'c0000000-0000-4000-8000-000000000001' AND week_start = public._w();
  ASSERT (SELECT e->'times' FROM jsonb_array_elements(v_days -> (public._w() + 2)::text) e
          WHERE e->>'title' = 'Daily') = '["12:00", "12:00"]'::jsonb,
    'TEST 1i FAILED: Tuesday''s two check-ins should keep their times';
  ASSERT (SELECT e->>'reason' FROM jsonb_array_elements(v_days -> (public._w() + 5)::text) e
          WHERE e->>'title' = 'Daily') = 'rest',
    'TEST 1i FAILED: Friday''s rain check should keep its reason';
  ASSERT (SELECT bool_and((e->>'weekly')::boolean = (e->>'title' = 'Weekly'))
          FROM jsonb_array_elements(v_days -> public._w()::text) e),
    'TEST 1i FAILED: only Weekly is marked weekly';
  RAISE NOTICE 'TEST 1i PASSED: check-in times, a rain check''s reason and weekly habits are kept';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a saved week stays as it was
-- ---------------------------------------------------------------------------

SELECT public._done('c1000000-0000-4000-8000-000000000001', public._w() + 6);

DO $$
BEGIN
  ASSERT NOT public.save_weekly_review('c0000000-0000-4000-8000-000000000001', public._w()),
    'TEST 2a FAILED: a saved week was saved again';
  ASSERT (SELECT done FROM public.weekly_reviews
          WHERE user_id = 'c0000000-0000-4000-8000-000000000001' AND week_start = public._w()) = 5,
    'TEST 2a FAILED: a saved week changed';
  RAISE NOTICE 'TEST 2a PASSED: a late check-in does not change a saved week';

  DELETE FROM public.habits WHERE id = 'c1000000-0000-4000-8000-000000000001';
  ASSERT (SELECT top_habit_id IS NULL AND top_habit_title = 'Daily'
          FROM public.weekly_reviews
          WHERE user_id = 'c0000000-0000-4000-8000-000000000001' AND week_start = public._w()),
    'TEST 2b FAILED: deleting the top habit should keep its title';
  RAISE NOTICE 'TEST 2b PASSED: the week still names a habit once it is deleted';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: what is not saved, and a week saved after the fact
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r public.weekly_reviews%ROWTYPE;
BEGIN
  ASSERT NOT public.save_weekly_review('c0000000-0000-4000-8000-000000000001', public._w() + 7),
    'TEST 3a FAILED: this week is not over and was saved';
  RAISE NOTICE 'TEST 3a PASSED: a week is not saved before it is over';

  BEGIN
    PERFORM public.save_weekly_review('c0000000-0000-4000-8000-000000000001', public._w() + 1);
    RAISE EXCEPTION 'TEST 3b FAILED: a week starting on a Monday was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'TEST 3b FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'TEST 3b PASSED: a week must start on a Sunday';
  END;

  -- The week before last, Daily deleted by now: Weekly is due and missed,
  -- Paused due every day.
  ASSERT public.save_weekly_review('c0000000-0000-4000-8000-000000000001', public._w() - 7, false),
    'TEST 3c FAILED: the week before last was not saved';
  SELECT * INTO r FROM public.weekly_reviews
  WHERE user_id = 'c0000000-0000-4000-8000-000000000001' AND week_start = public._w() - 7;
  ASSERT r.due = 8 AND r.done = 0 AND r.completions = 0 AND r.best_streak IS NULL
     AND r.top_habit_id IS NULL AND r.encouragements_sent = 1,
    format('TEST 3c FAILED: got due %s, done %s, streak %s, sent %s', r.due, r.done, r.best_streak, r.encouragements_sent);
  RAISE NOTICE 'TEST 3c PASSED: a week saved after the fact leaves its best streak empty';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: only the owner reads them, and nobody writes them
-- ---------------------------------------------------------------------------

INSERT INTO public.weekly_reviews (user_id, week_start, due, done, completions, encouragements_sent, encouragements_received)
VALUES ('c0000000-0000-4000-8000-000000000002', public._w(), 1, 1, 1, 0, 0);

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.weekly_reviews) = 2
     AND NOT EXISTS (SELECT 1 FROM public.weekly_reviews
                     WHERE user_id <> 'c0000000-0000-4000-8000-000000000001'),
    'TEST 4a FAILED: a signed-in user should read their own weeks only';
  RAISE NOTICE 'TEST 4a PASSED: the owner reads their own weeks, and nobody else''s';

  BEGIN
    INSERT INTO public.weekly_reviews (user_id, week_start, due, done, completions, encouragements_sent, encouragements_received)
    VALUES ('c0000000-0000-4000-8000-000000000001', public._w() - 14, 9, 9, 9, 0, 0);
    RAISE EXCEPTION 'TEST 4b FAILED: a user wrote their own week';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 4b PASSED: a user cannot write a week';
  END;

  BEGIN
    UPDATE public.weekly_reviews SET done = due;
    RAISE EXCEPTION 'TEST 4c FAILED: a user changed their week';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 4c PASSED: a user cannot change a week';
  END;

  BEGIN
    PERFORM public.save_weekly_reviews();
    RAISE EXCEPTION 'TEST 4d FAILED: a user ran the hourly save';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 4d PASSED: a user cannot run the saves';
  END;

  BEGIN
    PERFORM public.weekly_review_numbers('c0000000-0000-4000-8000-000000000002', public._w(), true);
    RAISE EXCEPTION 'TEST 4e FAILED: a user worked out someone else''s week';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 4e PASSED: a user cannot work out anyone''s week directly';
  END;

  ASSERT (SELECT r.due || '/' || r.done FROM public.get_habit_rate('c1000000-0000-4000-8000-000000000002') r) IS NOT NULL,
    'TEST 4f FAILED: get_habit_rate should still answer for the owner';
  RAISE NOTICE 'TEST 4f PASSED: get_habit_rate still answers for the owner';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: the week so far, for the signed-in person only
-- ---------------------------------------------------------------------------

RESET role;
-- A check-in today, on a habit made today: counted, and not saved anywhere.
INSERT INTO public.completions (habit_id, user_id, completion_type)
VALUES ('c1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'quick');

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  r public.weekly_reviews%ROWTYPE;
  v_rows INT;
BEGIN
  SELECT count(*) INTO v_rows FROM public.get_current_week_review();
  SELECT * INTO r FROM public.get_current_week_review();
  ASSERT v_rows = 1 AND r.user_id = 'c0000000-0000-4000-8000-000000000001'
     AND r.week_start = public._w() + 7,
    format('TEST 5a FAILED: one row for this week, got %s starting %s', v_rows, r.week_start);
  ASSERT r.completions >= 1 AND r.done >= 1 AND r.top_habit_id IS NOT NULL
     AND r.best_streak IS NOT NULL,
    format('TEST 5a FAILED: today''s check-in should count, got %s done of %s', r.done, r.due);
  ASSERT NOT EXISTS (SELECT 1 FROM public.weekly_reviews WHERE week_start = public._w() + 7),
    'TEST 5a FAILED: the week so far was saved';
  RAISE NOTICE 'TEST 5a PASSED: the week so far counts today''s check-in, and is not saved';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_current_week_review()),
    'TEST 5b FAILED: someone with no habit should get no week';
  RAISE NOTICE 'TEST 5b PASSED: no habit, no week';
END $$;

SET LOCAL role TO anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

DO $$
BEGIN
  PERFORM public.get_current_week_review();
  RAISE EXCEPTION 'TEST 5c FAILED: signed out, the week so far was answered';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'TEST 5c PASSED: signed out, there is no week so far';
END $$;

ROLLBACK;
