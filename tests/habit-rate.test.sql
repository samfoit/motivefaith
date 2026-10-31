-- =============================================================================
-- A habit's rate counts the days it was due (migration 050)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/habit-rate.test.sql
--
-- get_habit_rate() counts due days — or weeks, for a weekly habit — and the
-- ones done: by the schedule each day had, leaving out paused days, days a
-- rain check excused, check-ins on days off, and today until it is done.
--
-- It reads the real clock, so every day here counts back from the real
-- today, whatever weekday it is. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Weekly habits stand here for ones kept weekly before 052, whose weeks are
-- still judged as weekly. 052 refuses new ones; this rolls back with the rest.
ALTER TABLE public.habits DROP CONSTRAINT IF EXISTS chk_habit_not_weekly;

CREATE FUNCTION public._today() RETURNS DATE
LANGUAGE sql AS $fn$ SELECT (now() AT TIME ZONE 'UTC')::date $fn$;

CREATE FUNCTION public._days_ago(n INT) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $fn$ SELECT ((public._today() - n) + time '12:00') AT TIME ZONE 'UTC' $fn$;

CREATE FUNCTION public._dow_ago(n INT) RETURNS INT
LANGUAGE sql AS $fn$ SELECT EXTRACT(DOW FROM public._today() - n)::int $fn$;

CREATE FUNCTION public._sunday() RETURNS DATE
LANGUAGE sql AS $fn$ SELECT public._today() - EXTRACT(DOW FROM public._today())::int $fn$;

-- "due/done", as get_habit_rate returns it.
CREATE FUNCTION public._rate(p_habit UUID) RETURNS TEXT
LANGUAGE sql AS $fn$ SELECT r.due || '/' || r.done FROM public.get_habit_rate(p_habit) r $fn$;

CREATE FUNCTION public._done(p_habit UUID, VARIADIC p_days_ago INT[]) RETURNS VOID
LANGUAGE sql AS $fn$
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  SELECT p_habit, 'b0000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
  FROM unnest(p_days_ago) AS n
$fn$;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hr-rae@test.com',      crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"hr_rae"}'::jsonb,      now(), now()),
  ('b0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hr-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"hr_stranger"}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Rae', timezone = 'UTC'
WHERE id IN ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002');

-- Every day     created a week ago, missed three days ago
-- Some days     due two days ago and five days ago only, done on both and on
--               a day off between
-- Weekly        done in the two weeks before last, not last week
-- Rested        every day, paused four and three days ago, rain-checked two
-- Changed       due only five days ago until two days ago, every day since
INSERT INTO public.habits (id, user_id, title, frequency, schedule, created_at) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Every day', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', public._days_ago(7)),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Some days', 'specific_days',
   jsonb_build_object('days', jsonb_build_array(public._dow_ago(2), public._dow_ago(5))), public._days_ago(6)),
  ('b1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Weekly', 'weekly',
   '{"days":[0,1,2,3,4,5,6]}', ((public._sunday() - 21) + time '12:00') AT TIME ZONE 'UTC'),
  ('b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'Rested', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', public._days_ago(5)),
  ('b1000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 'Changed', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', public._days_ago(6));

SELECT public._done('b1000000-0000-4000-8000-000000000001', 7, 6, 5, 4, 2, 1);
SELECT public._done('b1000000-0000-4000-8000-000000000002', 5, 4, 2);
-- A weekly habit's check-ins go in a statement per week.
SELECT public._done('b1000000-0000-4000-8000-000000000003', (public._today() - (public._sunday() - 20))::int);
SELECT public._done('b1000000-0000-4000-8000-000000000003', (public._today() - (public._sunday() - 12))::int);
SELECT public._done('b1000000-0000-4000-8000-000000000004', 5, 1);
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('b1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'rain_check', 'rest', public._days_ago(2));
INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('b1000000-0000-4000-8000-000000000004', public._today() - 4, public._today() - 2);
INSERT INTO public.habit_schedule_changes (habit_id, changed_on, frequency, days)
VALUES ('b1000000-0000-4000-8000-000000000005', public._today() - 2, 'specific_days', jsonb_build_array(public._dow_ago(5)));
SELECT public._done('b1000000-0000-4000-8000-000000000005', 5, 2, 1);

-- ---------------------------------------------------------------------------
-- Test 1: days due and done
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  ASSERT public._rate('b1000000-0000-4000-8000-000000000001') = '7/6',
    format('TEST 1a FAILED: a week of every day with one missed should be 7/6, got %s',
           public._rate('b1000000-0000-4000-8000-000000000001'));
  RAISE NOTICE 'TEST 1a PASSED: every day since it was created is due, and today waits until it is done';

  ASSERT public._rate('b1000000-0000-4000-8000-000000000002') = '2/2',
    format('TEST 1b FAILED: two days due, both done, should be 2/2, got %s',
           public._rate('b1000000-0000-4000-8000-000000000002'));
  RAISE NOTICE 'TEST 1b PASSED: only scheduled days are due, and a check-in on a day off counts for nothing';

  ASSERT public._rate('b1000000-0000-4000-8000-000000000003') = '3/2',
    format('TEST 1c FAILED: three weeks due, two done, should be 3/2, got %s',
           public._rate('b1000000-0000-4000-8000-000000000003'));
  RAISE NOTICE 'TEST 1c PASSED: a weekly habit is due once a week, and this week waits until it is done';

  ASSERT public._rate('b1000000-0000-4000-8000-000000000004') = '2/2',
    format('TEST 1d FAILED: paused and rain-checked days should be left out, got %s',
           public._rate('b1000000-0000-4000-8000-000000000004'));
  RAISE NOTICE 'TEST 1d PASSED: paused days and a rain-checked one are not due';

  ASSERT public._rate('b1000000-0000-4000-8000-000000000005') = '3/3',
    format('TEST 1e FAILED: days before the change should keep their schedule, got %s',
           public._rate('b1000000-0000-4000-8000-000000000005'));
  RAISE NOTICE 'TEST 1e PASSED: each day is due by the schedule it had';

  PERFORM public.insert_completion('b1000000-0000-4000-8000-000000000001', 'quick');
  ASSERT public._rate('b1000000-0000-4000-8000-000000000001') = '8/7',
    format('TEST 1f FAILED: done today, today should count, got %s',
           public._rate('b1000000-0000-4000-8000-000000000001'));
  RAISE NOTICE 'TEST 1f PASSED: done, today counts';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: only the owner's
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  ASSERT public._rate('b1000000-0000-4000-8000-000000000001') = '0/0',
    format('TEST 2 FAILED: a stranger read someone else''s rate: %s',
           public._rate('b1000000-0000-4000-8000-000000000001'));
  RAISE NOTICE 'TEST 2 PASSED: a stranger reads nothing';
END $$;

RESET role;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.get_habit_rate(uuid)', 'EXECUTE'),
    'TEST 2 FAILED: signed out, the rate can be asked for';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL HABIT RATE TESTS PASSED ==='; END $$;

ROLLBACK;
