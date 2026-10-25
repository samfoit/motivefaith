-- =============================================================================
-- Doing a habit more than once a day (migration 044)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/repeat-checkins.test.sql
--
-- The first real check-in of a day completes the habit and advances its
-- streak. Every one after it is recorded and adds to the total, but the day
-- is already in the streak — for a weekly habit, the week. The capture
-- picker still lists a habit once it is done, and a habit's days done count
-- each day once.
--
-- No vault secrets here, so notify_completion returns before sending any push.
-- Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner     keeps every habit below
-- stranger  no relationship to anyone

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-owner@test.com',    crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"rc_owner"}'::jsonb,    now(), now()),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"rc_stranger"}'::jsonb, now(), now());

UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003');

-- Created a minute apart, oldest first, so the picker's order is not left to
-- chance among rows written in one transaction.
INSERT INTO public.habits (id, user_id, title, frequency, schedule, is_paused, created_at) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Water',   'daily',  '{"days":[0,1,2,3,4,5,6]}', false, now() - interval '60 minutes'),
  ('a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Sabbath', 'weekly', '{"days":[0,1,2,3,4,5,6]}', false, now() - interval '59 minutes'),
  ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Read',    'daily',  '{"days":[0,1,2,3,4,5,6]}', false, now() - interval '58 minutes'),
  ('a5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'Skipped', 'daily',  '{"days":[0,1,2,3,4,5,6]}', false, now() - interval '57 minutes'),
  ('a5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'Anyday',  'daily',  NULL,                       false, now() - interval '56 minutes'),
  ('a5000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', 'Paused',  'daily',  '{"days":[0,1,2,3,4,5,6]}', true,  now() - interval '55 minutes');

-- Every day but today, so it is not due.
INSERT INTO public.habits (id, user_id, title, frequency, schedule, created_at)
SELECT 'a5000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'Not today', 'daily',
       jsonb_build_object('days', (
         SELECT jsonb_agg(d) FROM generate_series(0, 6) AS d
         WHERE d <> EXTRACT(DOW FROM now() AT TIME ZONE 'UTC')::int
       )),
       now() - interval '54 minutes';

-- ---------------------------------------------------------------------------
-- Test 1: only the day's first check-in moves the streak
-- ---------------------------------------------------------------------------

-- Yesterday's water, so today's first one makes it two.
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'quick', now() - interval '1 day');

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'quick', now());

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, streak_best, total_completions INTO h
    FROM public.habits WHERE id = 'a5000000-0000-4000-8000-000000000001';
  ASSERT h.streak_current = 2 AND h.total_completions = 2,
    format('TEST 1 SETUP FAILED: expected streak 2 and total 2, got %s and %s', h.streak_current, h.total_completions);
END $$;

INSERT INTO public.completions (habit_id, user_id, completion_type, evidence_url, completed_at)
VALUES ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'photo',
        'a1000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-000000000001/again.webp', now());

-- And once more through the app's own path, kept private: the shared row is
-- a quick check-in, written by insert_completion like any other.
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$ BEGIN
  PERFORM public.insert_private_completion(
    'a5000000-0000-4000-8000-000000000001', 'message', NULL, 'third glass'
  );
END $$;
RESET role;

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, streak_best, total_completions INTO h
    FROM public.habits WHERE id = 'a5000000-0000-4000-8000-000000000001';
  ASSERT h.streak_current = 2,
    format('TEST 1 FAILED: doing it again today moved the streak to %s', h.streak_current);
  ASSERT h.streak_best = 2,
    format('TEST 1 FAILED: doing it again today moved the best streak to %s', h.streak_best);
  ASSERT h.total_completions = 4,
    format('TEST 1 FAILED: every check-in should add to the total, got %s', h.total_completions);
  ASSERT (SELECT count(*) FROM public.completions
          WHERE habit_id = 'a5000000-0000-4000-8000-000000000001'
            AND completed_date = (now() AT TIME ZONE 'UTC')::date) = 3,
    'TEST 1 FAILED: all three of today''s check-ins should be kept';
  RAISE NOTICE 'TEST 1 PASSED: a second and third check-in today are kept and counted, but the streak moves once';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a weekly habit's streak moves once a week
-- ---------------------------------------------------------------------------
-- Monday and Wednesday of last week: always in the past, always one week
-- (Sunday to Saturday, as update_streak() counts it).

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'quick',
       ((today - EXTRACT(DOW FROM today)::int - 6) + time '12:00') AT TIME ZONE 'UTC'
FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t;

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'photo',
       ((today - EXTRACT(DOW FROM today)::int - 4) + time '12:00') AT TIME ZONE 'UTC'
FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t;

DO $$
DECLARE h RECORD;
BEGIN
  SELECT streak_current, total_completions INTO h
    FROM public.habits WHERE id = 'a5000000-0000-4000-8000-000000000002';
  ASSERT h.streak_current = 1,
    format('TEST 2 FAILED: a second check-in in the week moved the streak to %s', h.streak_current);
  ASSERT h.total_completions = 2,
    format('TEST 2 FAILED: expected both check-ins in the total, got %s', h.total_completions);
  RAISE NOTICE 'TEST 2 PASSED: a weekly habit done twice in a week is one step on its streak';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the capture picker lists today's habits, done ones last
-- ---------------------------------------------------------------------------

-- Skipped this morning.
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('a5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'rain_check', 'busy', now());

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  v_titles TEXT[];
  v_done TEXT[];
BEGIN
  SELECT array_agg(title ORDER BY ord), array_agg(title ORDER BY ord) FILTER (WHERE checked_in_today)
    INTO v_titles, v_done
  FROM public.get_habits_due_today('UTC') WITH ORDINALITY AS r(id, title, emoji, color, streak_current, frequency, partner_ids, group_ids, private_checkins, checked_in_today, ord);

  -- Sabbath's check-ins were last week, so it is still to do today.
  ASSERT v_titles = ARRAY['Sabbath', 'Read', 'Skipped', 'Anyday', 'Water'],
    format('TEST 3 FAILED: expected the habits still to do, then the done one; got %s', v_titles);
  ASSERT v_done = ARRAY['Water'],
    format('TEST 3 FAILED: only Water is checked in today, got %s', v_done);
  RAISE NOTICE 'TEST 3 PASSED: done habits stay in the picker after the ones to do; a rain check is not a check-in; paused and off-day habits stay out';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: days done count each day once
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Yesterday, and today three times.
  ASSERT public.get_habit_days_done('a5000000-0000-4000-8000-000000000001') = 2,
    format('TEST 4 FAILED: Water was done on 2 days, got %s',
           public.get_habit_days_done('a5000000-0000-4000-8000-000000000001'));
  ASSERT public.get_habit_days_done('a5000000-0000-4000-8000-000000000004') = 0,
    'TEST 4 FAILED: a rain check is not a day done';
  RAISE NOTICE 'TEST 4 PASSED: days done count each day once, and no rain checks';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
BEGIN
  ASSERT public.get_habit_days_done('a5000000-0000-4000-8000-000000000001') = 0,
    'TEST 4b FAILED: a stranger counted someone else''s days';
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_habits_due_today('UTC')),
    'TEST 4b FAILED: a stranger was listed someone else''s habits';
  RAISE NOTICE 'TEST 4b PASSED: a stranger counts and lists nothing';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: signed out, neither answers
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT public.get_habit_days_done('a5000000-0000-4000-8000-000000000001')$q$,
    $q$SELECT * FROM public.get_habits_due_today('UTC')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 5 FAILED: anon could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'TEST 5 PASSED: signed out, neither answers';
END $$;

RESET role;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL REPEAT CHECK-IN TESTS PASSED ==='; END $$;

ROLLBACK;
