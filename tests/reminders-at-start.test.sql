-- =============================================================================
-- A habit's reminder comes when it starts, not before (migration 058)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/reminders-at-start.test.sql
--
-- The quarter-hourly run is a moment late in production, never exactly on the
-- quarter hour, so every moment here is a few seconds past one, as the edge
-- function would pass it. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- The titles reminded at a moment, with the day each is for.
CREATE FUNCTION public._reminded(p_at TIMESTAMPTZ) RETURNS TEXT[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(r.title || ' ' || r.reminder_date ORDER BY r.title), '{}')
  FROM public.get_habits_due_for_reminder(p_at) r
  WHERE r.user_id = 'ba000000-0000-4000-8000-000000000001'
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- rae  keeps every habit below, in New York, with push on and no quiet hours

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('ba000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ras-rae@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"ras_rae"}'::jsonb, now(), now());

UPDATE public.profiles SET timezone = 'America/New_York', notification_prefs = '{}'::jsonb
WHERE id = 'ba000000-0000-4000-8000-000000000001';

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ('https://push.test/rae', 'ba000000-0000-4000-8000-000000000001', 'x', 'y');

-- Ten   every day at 10:00, on the quarter hour
-- Two   every day at 10:02, an exact minute
-- Late  Thursdays only, at 23:50
-- Mid   Fridays only, at midnight
INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at) VALUES
  ('bb000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'Ten', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"10:00","end":"11:00"}', '2026-10-01 00:00+00'),
  ('bb000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001', 'Two', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"10:02","end":"11:00"}', '2026-10-01 00:00+00'),
  ('bb000000-0000-4000-8000-000000000003', 'ba000000-0000-4000-8000-000000000001', 'Late', 'specific_days',
   '{"days":[4]}', '{"start":"23:50","end":"23:59"}', '2026-10-01 00:00+00'),
  ('bb000000-0000-4000-8000-000000000004', 'ba000000-0000-4000-8000-000000000001', 'Mid', 'specific_days',
   '{"days":[5]}', '{"start":"00:00","end":"01:00"}', '2026-10-01 00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: a habit on the quarter hour is reminded as it starts
-- ---------------------------------------------------------------------------
-- Thursday 8 October 2026; New York is UTC-4.

DO $$
BEGIN
  ASSERT public._reminded('2026-10-08 13:45:02+00') = '{}',
    format('TEST 1a FAILED: 9:45 reminded %s, ahead of the start', public._reminded('2026-10-08 13:45:02+00'));
  ASSERT public._reminded('2026-10-08 14:00:02+00') = ARRAY['Ten 2026-10-08'],
    format('TEST 1b FAILED: 10:00, two seconds late, reminded %s', public._reminded('2026-10-08 14:00:02+00'));
  ASSERT public._reminded('2026-10-08 14:00:00+00') = ARRAY['Ten 2026-10-08'],
    format('TEST 1c FAILED: 10:00 exactly reminded %s', public._reminded('2026-10-08 14:00:00+00'));
  RAISE NOTICE 'TEST 1 PASSED: a quarter-hour habit is reminded at its start, however late the run';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: an exact minute is reminded at the next quarter, never before
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT public._reminded('2026-10-08 14:15:03+00') = ARRAY['Two 2026-10-08'],
    format('TEST 2 FAILED: 10:15 reminded %s', public._reminded('2026-10-08 14:15:03+00'));
  ASSERT public._reminded('2026-10-08 14:30:03+00') = '{}',
    format('TEST 2 FAILED: 10:30 reminded %s', public._reminded('2026-10-08 14:30:03+00'));
  RAISE NOTICE 'TEST 2 PASSED: 10:02 is reminded at 10:15';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: midnight reminds about the day before, and the day it is
-- ---------------------------------------------------------------------------
-- Late (Thursday, 23:50) is reminded at Friday's first run, as Thursday's;
-- Mid (Friday, 00:00) at the same run, as Friday's.

DO $$
BEGIN
  ASSERT public._reminded('2026-10-09 03:45:04+00') = '{}',
    format('TEST 3a FAILED: Thursday 23:45 reminded %s', public._reminded('2026-10-09 03:45:04+00'));
  ASSERT public._reminded('2026-10-09 04:00:04+00') = ARRAY['Late 2026-10-08', 'Mid 2026-10-09'],
    format('TEST 3b FAILED: Friday 0:00 reminded %s', public._reminded('2026-10-09 04:00:04+00'));
  RAISE NOTICE 'TEST 3 PASSED: midnight reminds about 23:50 under the day it belongs to';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: once reminded, not again that day; done, not at all
-- ---------------------------------------------------------------------------

UPDATE public.habits SET last_reminder_date = '2026-10-08'
WHERE id = 'bb000000-0000-4000-8000-000000000003';

INSERT INTO public.completions (habit_id, user_id, completed_date, completed_at)
VALUES ('bb000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
        '2026-10-10', '2026-10-10 13:30+00');

DO $$
BEGIN
  ASSERT public._reminded('2026-10-09 04:00:04+00') = ARRAY['Mid 2026-10-09'],
    format('TEST 4a FAILED: Late, reminded Thursday, came again: %s', public._reminded('2026-10-09 04:00:04+00'));
  ASSERT public._reminded('2026-10-10 14:00:04+00') = '{}',
    format('TEST 4b FAILED: Ten, done at 9:30, was reminded at 10: %s', public._reminded('2026-10-10 14:00:04+00'));
  RAISE NOTICE 'TEST 4 PASSED: a habit reminded or done that day is left alone';
END $$;

ROLLBACK;
