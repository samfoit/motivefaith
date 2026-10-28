-- =============================================================================
-- Past days keep the schedule they had (migration 049)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/schedule-changes.test.sql
--
-- Each change to a habit's days or frequency is kept with the schedule it
-- replaced, and the streak judges each day by the schedule it had: adding a
-- day never turns a past off day into a miss, and taking one away never
-- excuses a miss. A switch between weekly and a daily kind keeps the number
-- and the streak, as long as it still stood under the old schedule.
--
-- The streak functions read the real clock, so every day here counts back
-- from the real today, whatever weekday it is. Everything is rolled back at
-- the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION public._today() RETURNS DATE
LANGUAGE sql AS $fn$ SELECT (now() AT TIME ZONE 'UTC')::date $fn$;

-- Noon, n days ago: always that day, whatever the hour now.
CREATE FUNCTION public._days_ago(n INT) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $fn$ SELECT ((public._today() - n) + time '12:00') AT TIME ZONE 'UTC' $fn$;

-- The weekday n days ago, 0 = Sunday.
CREATE FUNCTION public._dow_ago(n INT) RETURNS INT
LANGUAGE sql AS $fn$ SELECT EXTRACT(DOW FROM public._today() - n)::int $fn$;

-- Every day of the week but the ones given, as schedule.days.
CREATE FUNCTION public._days_but(VARIADIC p_off INT[]) RETURNS JSONB
LANGUAGE sql AS $fn$
  SELECT jsonb_agg(d ORDER BY d) FROM generate_series(0, 6) d WHERE d <> ALL (p_off)
$fn$;

CREATE FUNCTION public._streak(p_habit UUID) RETURNS INT
LANGUAGE sql AS $fn$ SELECT streak_current FROM public.habits WHERE id = p_habit $fn$;

-- This week's Sunday.
CREATE FUNCTION public._sunday() RETURNS DATE
LANGUAGE sql AS $fn$ SELECT public._today() - EXTRACT(DOW FROM public._today())::int $fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- sam       keeps every habit below
-- stranger  no relationship to anyone

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('ae000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-sam@test.com',      crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"sc_sam"}'::jsonb,      now(), now()),
  ('ae000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sc-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"sc_stranger"}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Sam', timezone = 'UTC'
WHERE id = 'ae000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET timezone = 'UTC'
WHERE id = 'ae000000-0000-4000-8000-000000000002';

-- Every habit is sixty days old, and kept every day unless a test says.
INSERT INTO public.habits (id, user_id, title, frequency, schedule, created_at)
SELECT h.id::uuid, 'ae000000-0000-4000-8000-000000000001', h.title, h.frequency::habit_frequency,
       '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'
FROM (VALUES
  ('af000000-0000-4000-8000-000000000001', 'Kept',            'daily'),
  ('af000000-0000-4000-8000-000000000002', 'Widened',         'specific_days'),
  ('af000000-0000-4000-8000-000000000003', 'Widened, done',   'specific_days'),
  ('af000000-0000-4000-8000-000000000004', 'Narrowed',        'daily'),
  ('af000000-0000-4000-8000-000000000005', 'Twice changed',   'daily'),
  ('af000000-0000-4000-8000-000000000006', 'Made daily',      'weekly'),
  ('af000000-0000-4000-8000-000000000007', 'Made daily, done','weekly'),
  ('af000000-0000-4000-8000-000000000008', 'Lapsed weekly',   'weekly'),
  ('af000000-0000-4000-8000-000000000009', 'Daily since',     'daily'),
  ('af000000-0000-4000-8000-00000000000a', 'Made weekly',     'daily'),
  ('af000000-0000-4000-8000-00000000000b', 'Missed, weekly',  'daily'),
  ('af000000-0000-4000-8000-00000000000c', 'Redone, weekly',  'daily')
) AS h(id, title, frequency);

-- ---------------------------------------------------------------------------
-- Test 1: keeping the changes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  c RECORD;
BEGIN
  -- A rename from the edit sheet sends the schedule as it was, in any order,
  -- and the window with it.
  UPDATE public.habits
  SET title = 'Kept up', frequency = 'daily', schedule = '{"days":[6,5,4,3,2,1,0]}',
      time_window = '{"start":"08:00","end":"09:00","days":{}}'
  WHERE id = 'af000000-0000-4000-8000-000000000001';
  ASSERT NOT EXISTS (SELECT 1 FROM public.habit_schedule_changes
                     WHERE habit_id = 'af000000-0000-4000-8000-000000000001'),
    'TEST 1a FAILED: a save that left the schedule as it was kept a change';
  RAISE NOTICE 'TEST 1a PASSED: the same days in another order, or a new time, are no change to the schedule';

  UPDATE public.habits SET frequency = 'weeksdays', schedule = '{"days":[1,2,3,4,5]}'
  WHERE id = 'af000000-0000-4000-8000-000000000001';
  SELECT * INTO c FROM public.habit_schedule_changes
  WHERE habit_id = 'af000000-0000-4000-8000-000000000001';
  ASSERT c.changed_on = public._today() AND c.frequency = 'daily'
         AND c.days = '[6,5,4,3,2,1,0]'::jsonb,
    format('TEST 1b FAILED: expected today and the schedule before, got %s, %s, %s', c.changed_on, c.frequency, c.days);
  RAISE NOTICE 'TEST 1b PASSED: a change is kept from today, with the schedule it replaced';

  UPDATE public.habits SET frequency = 'weekends', schedule = '{"days":[0,6]}'
  WHERE id = 'af000000-0000-4000-8000-000000000001';
  ASSERT (SELECT count(*) FROM public.habit_schedule_changes
          WHERE habit_id = 'af000000-0000-4000-8000-000000000001') = 1,
    'TEST 1c FAILED: a second change today should not keep another row';
  ASSERT (SELECT frequency FROM public.habit_schedule_changes
          WHERE habit_id = 'af000000-0000-4000-8000-000000000001') = 'daily',
    'TEST 1c FAILED: a second change today replaced the schedule from before today';
  RAISE NOTICE 'TEST 1c PASSED: a second change the same day keeps the schedule from before the first';
END $$;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.habit_schedule_changes) = 1,
    'TEST 1d FAILED: the owner should read their own change';
  BEGIN
    INSERT INTO public.habit_schedule_changes (habit_id, changed_on, frequency, days)
    VALUES ('af000000-0000-4000-8000-000000000002', public._today() - 30, 'daily', '[0,1,2,3,4,5,6]');
    RAISE EXCEPTION 'TEST 1d FAILED: the owner wrote a schedule change by hand';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.habit_schedule_changes) = 0,
    'TEST 1d FAILED: a stranger read someone else''s schedule changes';
  RAISE NOTICE 'TEST 1d PASSED: schedule changes are the owner''s to read, and nobody''s to write';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 2: a day added keeps the days before as they were
-- ---------------------------------------------------------------------------
-- Widened and Widened, done: off on yesterday's weekday, done the three days
-- before it. Today both are made daily, which yesterday was not.

UPDATE public.habits SET schedule = jsonb_build_object('days', public._days_but(public._dow_ago(1)))
WHERE id IN ('af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000003');

-- That schedule was set today too, which a test can't help: its change is
-- moved back out of the way, as if it had always been so.
UPDATE public.habit_schedule_changes SET changed_on = public._today() - 30
WHERE habit_id IN ('af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000003');

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY['af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000003']::uuid[]) AS h,
     unnest(ARRAY[4, 3, 2]) AS n
ORDER BY h, n DESC;

UPDATE public.habits SET frequency = 'daily', schedule = '{"days":[0,1,2,3,4,5,6]}'
WHERE id IN ('af000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000003');

SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000002') = 3,
    format('TEST 2a FAILED: the sweep took yesterday, off when it passed, for a miss: streak %s',
           public._streak('af000000-0000-4000-8000-000000000002'));
  RAISE NOTICE 'TEST 2a PASSED: made daily, yesterday is still a day off, and the sweep keeps the streak';

  PERFORM public.insert_completion('af000000-0000-4000-8000-000000000003', 'quick');
  ASSERT public._streak('af000000-0000-4000-8000-000000000003') = 4,
    format('TEST 2b FAILED: the first check-in after the change should make it 4, got %s',
           public._streak('af000000-0000-4000-8000-000000000003'));
  RAISE NOTICE 'TEST 2b PASSED: and the first check-in after carries it on';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 3: a day taken away doesn't excuse its miss
-- ---------------------------------------------------------------------------
-- Narrowed: daily, done three and two days ago, missed yesterday. Before the
-- sweep comes round, yesterday's weekday is taken off its schedule.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-000000000004', 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[3, 2]) AS n
ORDER BY n DESC;

UPDATE public.habits
SET frequency = 'specific_days', schedule = jsonb_build_object('days', public._days_but(public._dow_ago(1)))
WHERE id = 'af000000-0000-4000-8000-000000000004';

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000004') = 0,
    format('TEST 3 FAILED: taking yesterday off the schedule excused missing it: streak %s',
           public._streak('af000000-0000-4000-8000-000000000004'));
  RAISE NOTICE 'TEST 3 PASSED: a day taken off the schedule after it was missed is still missed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: each day reads the change that came after it
-- ---------------------------------------------------------------------------
-- Twice changed: every day until five days ago, then off three and four days
-- ago, then every day again from two days ago. Done six, five, two and one
-- days ago. The changes are kept first, as they would have been.

INSERT INTO public.habit_schedule_changes (habit_id, changed_on, frequency, days) VALUES
  ('af000000-0000-4000-8000-000000000005', public._today() - 5, 'daily', '[0,1,2,3,4,5,6]'),
  ('af000000-0000-4000-8000-000000000005', public._today() - 2, 'specific_days',
   public._days_but(public._dow_ago(3), public._dow_ago(4)));

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-000000000005', 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[6, 5, 2, 1]) AS n
ORDER BY n DESC;

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000005') = 4,
    format('TEST 4 FAILED: the days off between the changes broke the streak: %s',
           public._streak('af000000-0000-4000-8000-000000000005'));
  ASSERT public.habit_last_due_day('af000000-0000-4000-8000-000000000005', '[0,1,2,3,4,5,6]', public._today() - 2)
         = public._today() - 5,
    'TEST 4 FAILED: stepping back from two days ago should pass the days off to five days ago';
  RAISE NOTICE 'TEST 4 PASSED: each day is judged by the schedule it had, across more than one change';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: a weekly habit made daily keeps its streak until its first day due
-- ---------------------------------------------------------------------------
-- Made daily and Made daily, done: done once in each of the three weeks
-- before this one, so three weeks running. Lapsed weekly: done in the three
-- weeks before last, so its streak had ended, but the sweep hadn't come round.
-- One statement per week: update_streak() reads a weekly habit's week as
-- everything from its Sunday on.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'ae000000-0000-4000-8000-000000000001', 'quick', ((public._sunday() - 20) + time '12:00') AT TIME ZONE 'UTC'
FROM unnest(ARRAY['af000000-0000-4000-8000-000000000006', 'af000000-0000-4000-8000-000000000007']::uuid[]) AS h;
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'ae000000-0000-4000-8000-000000000001', 'quick', ((public._sunday() - 13) + time '12:00') AT TIME ZONE 'UTC'
FROM unnest(ARRAY['af000000-0000-4000-8000-000000000006', 'af000000-0000-4000-8000-000000000007']::uuid[]) AS h;
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'ae000000-0000-4000-8000-000000000001', 'quick', ((public._sunday() - 6) + time '12:00') AT TIME ZONE 'UTC'
FROM unnest(ARRAY['af000000-0000-4000-8000-000000000006', 'af000000-0000-4000-8000-000000000007']::uuid[]) AS h;

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-000000000008', 'ae000000-0000-4000-8000-000000000001', 'quick', ((public._sunday() - d) + time '12:00') AT TIME ZONE 'UTC'
FROM unnest(ARRAY[27]) AS d;
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-000000000008', 'ae000000-0000-4000-8000-000000000001', 'quick', ((public._sunday() - d) + time '12:00') AT TIME ZONE 'UTC'
FROM unnest(ARRAY[20]) AS d;
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-000000000008', 'ae000000-0000-4000-8000-000000000001', 'quick', ((public._sunday() - d) + time '12:00') AT TIME ZONE 'UTC'
FROM unnest(ARRAY[13]) AS d;

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000006') = 3
         AND public._streak('af000000-0000-4000-8000-000000000008') = 3,
    'TEST 5 SETUP FAILED: expected three weeks running on both';
END $$;

UPDATE public.habits SET frequency = 'daily'
WHERE id IN ('af000000-0000-4000-8000-000000000006', 'af000000-0000-4000-8000-000000000007',
             'af000000-0000-4000-8000-000000000008');

SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000006') = 3,
    format('TEST 5a FAILED: made daily today, its weekly streak should stand, got %s',
           public._streak('af000000-0000-4000-8000-000000000006'));
  RAISE NOTICE 'TEST 5a PASSED: made daily, a weekly streak keeps its number through the sweep';

  PERFORM public.insert_completion('af000000-0000-4000-8000-000000000007', 'quick');
  ASSERT public._streak('af000000-0000-4000-8000-000000000007') = 4,
    format('TEST 5b FAILED: the first check-in after should carry it on to 4, got %s',
           public._streak('af000000-0000-4000-8000-000000000007'));
  RAISE NOTICE 'TEST 5b PASSED: and the first check-in after carries it on';

  ASSERT public._streak('af000000-0000-4000-8000-000000000008') = 0,
    format('TEST 5c FAILED: a weekly streak that had lapsed survived being made daily: %s',
           public._streak('af000000-0000-4000-8000-000000000008'));
  RAISE NOTICE 'TEST 5c PASSED: one that had already lapsed ends';
END $$;
RESET role;

-- Daily since: weekly until yesterday, done last week, and not yesterday —
-- the first day it was due as a daily habit.
INSERT INTO public.habit_schedule_changes (habit_id, changed_on, frequency, days)
VALUES ('af000000-0000-4000-8000-000000000009', public._today() - 1, 'weekly', '[0,1,2,3,4,5,6]');
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('af000000-0000-4000-8000-000000000009', 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(8));
UPDATE public.habits SET streak_current = 5 WHERE id = 'af000000-0000-4000-8000-000000000009';

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000009') = 0,
    format('TEST 5d FAILED: its first day due as a daily habit was missed, and the streak stood: %s',
           public._streak('af000000-0000-4000-8000-000000000009'));
  RAISE NOTICE 'TEST 5d PASSED: missing the first day due after the change ends it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a daily habit made weekly keeps its streak, if it still stood
-- ---------------------------------------------------------------------------
-- Made weekly: done the ten days through yesterday. Missed, weekly: done
-- four, three and two days ago and missed yesterday, before the sweep came
-- round. Redone, weekly: the same, but done again today.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-00000000000a', 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM generate_series(10, 1, -1) AS n;

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY['af000000-0000-4000-8000-00000000000b', 'af000000-0000-4000-8000-00000000000c']::uuid[]) AS h,
     unnest(ARRAY[4, 3, 2]) AS n
ORDER BY h, n DESC;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$ BEGIN PERFORM public.insert_completion('af000000-0000-4000-8000-00000000000c', 'quick'); END $$;
RESET role;

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-00000000000a') = 10
         AND public._streak('af000000-0000-4000-8000-00000000000b') = 3
         AND public._streak('af000000-0000-4000-8000-00000000000c') = 1,
    format('TEST 6 SETUP FAILED: expected 10, 3 and 1, got %s, %s and %s',
           public._streak('af000000-0000-4000-8000-00000000000a'),
           public._streak('af000000-0000-4000-8000-00000000000b'),
           public._streak('af000000-0000-4000-8000-00000000000c'));
END $$;

UPDATE public.habits SET frequency = 'weekly'
WHERE id IN ('af000000-0000-4000-8000-00000000000a', 'af000000-0000-4000-8000-00000000000b',
             'af000000-0000-4000-8000-00000000000c');

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-00000000000a') = 10,
    format('TEST 6a FAILED: made weekly, a ten-day streak should keep its number, got %s',
           public._streak('af000000-0000-4000-8000-00000000000a'));
  ASSERT public._streak('af000000-0000-4000-8000-00000000000b') = 0,
    format('TEST 6b FAILED: made weekly the morning after a miss, the streak survived: %s',
           public._streak('af000000-0000-4000-8000-00000000000b'));
  ASSERT public._streak('af000000-0000-4000-8000-00000000000c') = 1,
    format('TEST 6c FAILED: done today, the streak should stand: %s',
           public._streak('af000000-0000-4000-8000-00000000000c'));
END $$;

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-00000000000a') = 10,
    format('TEST 6a FAILED: the weekly sweep took the streak made weekly, got %s',
           public._streak('af000000-0000-4000-8000-00000000000a'));
  RAISE NOTICE 'TEST 6a PASSED: made weekly, a daily streak keeps its number, through the sweep';
  RAISE NOTICE 'TEST 6b PASSED: one the old schedule had ended is not brought back by the switch';
  RAISE NOTICE 'TEST 6c PASSED: one started again today stands';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: reminders and missed alerts read today's schedule
-- ---------------------------------------------------------------------------
-- Thursday 8 October 2026, in UTC. Taken off Thursdays, a habit isn't
-- reminded or told missed that Thursday.

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ('https://push.test/sam', 'ae000000-0000-4000-8000-000000000001', 'x', 'y');
UPDATE public.profiles SET notification_prefs = '{}'::jsonb
WHERE id = 'ae000000-0000-4000-8000-000000000001';

INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at) VALUES
  ('af000000-0000-4000-8000-000000000010', 'ae000000-0000-4000-8000-000000000001', 'Thursdays off', 'specific_days',
   '{"days":[0,1,2,3,5,6]}', '{"start":"08:00","end":"09:00"}', '2026-10-01 00:00+00'),
  ('af000000-0000-4000-8000-000000000011', 'ae000000-0000-4000-8000-000000000001', 'Every day', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', '2026-10-01 00:00+00');

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_habits_due_for_reminder('2026-10-08 08:00+00')
                     WHERE id = 'af000000-0000-4000-8000-000000000010'),
    'TEST 7 FAILED: a habit off on Thursdays was reminded on a Thursday';
  ASSERT EXISTS (SELECT 1 FROM public.get_habits_due_for_reminder('2026-10-08 08:00+00')
                 WHERE id = 'af000000-0000-4000-8000-000000000011'),
    'TEST 7 FAILED: a daily habit was not reminded on a Thursday';
  RAISE NOTICE 'TEST 7 PASSED: a day off the schedule is not reminded';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: a streak started again today survives the sweep
-- ---------------------------------------------------------------------------
-- Done three and two days ago, missed yesterday: the first sweep after
-- midnight ends the streak. Done today, it starts again at 1 — and the sweeps
-- for the rest of the day leave it there.

INSERT INTO public.habits (id, user_id, title, frequency, schedule, created_at) VALUES
  ('af000000-0000-4000-8000-000000000012', 'ae000000-0000-4000-8000-000000000001', 'Started again', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days');
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'af000000-0000-4000-8000-000000000012', 'ae000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[3, 2]) AS n
ORDER BY n DESC;

SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000012') = 0,
    'TEST 8 SETUP FAILED: the miss yesterday should have ended the streak';
  PERFORM public.insert_completion('af000000-0000-4000-8000-000000000012', 'quick');
  ASSERT public._streak('af000000-0000-4000-8000-000000000012') = 1,
    'TEST 8 SETUP FAILED: today''s check-in should start it again at 1';
END $$;
RESET role;

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('af000000-0000-4000-8000-000000000012') = 1,
    format('TEST 8 FAILED: the next sweep took today''s 1 for yesterday''s miss: streak %s',
           public._streak('af000000-0000-4000-8000-000000000012'));
  RAISE NOTICE 'TEST 8 PASSED: done today, a streak started again stands through the day''s sweeps';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL SCHEDULE CHANGE TESTS PASSED ==='; END $$;

ROLLBACK;
