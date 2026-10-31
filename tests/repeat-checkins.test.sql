-- =============================================================================
-- Doing a habit more than once a day (migration 044)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/repeat-checkins.test.sql
--
-- The first real check-in of a day completes the habit and advances its
-- streak. Every one after it is recorded and adds to the total, but the day
-- is already in the streak — for a weekly habit, the week. The capture
-- picker still lists a habit once it is done, a habit's days done count
-- each day once, and partners are pushed a repeat only when it has a photo,
-- video, voice note or note in it.
--
-- pg_net is not installed on a local stack, so `net` is stubbed to record the
-- push the notify triggers would send. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Weekly habits stand here for ones kept weekly before 052, whose weeks are
-- still judged as weekly. 052 refuses new ones; this rolls back with the rest.
ALTER TABLE public.habits DROP CONSTRAINT IF EXISTS chk_habit_not_weekly;

-- ---------------------------------------------------------------------------
-- Stub the outbound call and the secrets that gate it
-- ---------------------------------------------------------------------------

CREATE SCHEMA net;

CREATE TABLE public._sent_push (
  id   SERIAL PRIMARY KEY,
  url  TEXT,
  body JSONB
);

CREATE FUNCTION net.http_post(
  url TEXT,
  body JSONB DEFAULT '{}'::jsonb,
  params JSONB DEFAULT '{}'::jsonb,
  headers JSONB DEFAULT '{}'::jsonb,
  timeout_milliseconds INT DEFAULT 5000
) RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO public._sent_push (url, body) VALUES (url, body);
  RETURN 1;
END;
$fn$;

GRANT INSERT, SELECT ON public._sent_push TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public._sent_push_id_seq TO authenticated;

SELECT vault.create_secret('http://stub', 'supabase_url');
SELECT vault.create_secret('stub-service-key', 'service_role_key');

CREATE FUNCTION public._push_count() RETURNS INT
LANGUAGE sql AS $fn$ SELECT count(*)::int FROM public._sent_push $fn$;

CREATE FUNCTION public._last_push() RETURNS JSONB
LANGUAGE sql AS $fn$
  SELECT body FROM public._sent_push ORDER BY id DESC LIMIT 1
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner     keeps every habit below
-- stranger  no relationship to anyone
--
-- Test 6 brings its own: rae, whose habits pip partners on.

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
-- Test 6: partners are pushed a repeat only when it has something to see
-- ---------------------------------------------------------------------------
-- rae  keeps four habits, all partnered with pip
-- pip  push on, and no quiet hours to hold a push back

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-rae@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"rc_rae"}'::jsonb, now(), now()),
  ('a4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-pip@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"rc_pip"}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Rae', timezone = 'UTC'
WHERE id = 'a2000000-0000-4000-8000-000000000002';
UPDATE public.profiles SET display_name = 'Pip', timezone = 'UTC', notification_prefs = '{}'::jsonb
WHERE id = 'a4000000-0000-4000-8000-000000000004';

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ('https://push.test/pip', 'a4000000-0000-4000-8000-000000000004', 'x', 'y');

INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'Pray',    '🙏', 'daily',  '{"days":[0,1,2,3,4,5,6]}'),
  ('a6000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'Walk',    '🚶', 'daily',  '{"days":[0,1,2,3,4,5,6]}'),
  ('a6000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'Stretch', NULL, 'daily',  '{"days":[0,1,2,3,4,5,6]}'),
  ('a6000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'Fast',    '🍞', 'weekly', '{"days":[0,1,2,3,4,5,6]}');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, notify_complete)
SELECT h, 'a4000000-0000-4000-8000-000000000004', 'accepted', 'a2000000-0000-4000-8000-000000000002', true
FROM unnest(ARRAY[
  'a6000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000002',
  'a6000000-0000-4000-8000-000000000003',
  'a6000000-0000-4000-8000-000000000004'
]::uuid[]) AS h;

DO $$
DECLARE v_before INT := public._push_count();
BEGIN
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'quick', now());
  ASSERT public._push_count() = v_before + 1, 'TEST 6a FAILED: the day''s first check-in should push';
  ASSERT public._last_push()->>'title' = '🙏 Rae completed Pray',
    format('TEST 6a FAILED: wrong title %s', public._last_push()->>'title');

  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'quick', now());
  ASSERT public._push_count() = v_before + 1, 'TEST 6b FAILED: a quick check-in on a habit done today pushed';
  RAISE NOTICE 'TEST 6a-b PASSED: the first check-in pushes; a quick one after it does not';
END $$;

-- Kept private, through the app's own path: partners get a plain quick
-- check-in, so it is as quiet as one.
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}';
DO $$
DECLARE v_before INT := public._push_count();
BEGIN
  PERFORM public.insert_private_completion(
    'a6000000-0000-4000-8000-000000000001', 'message', NULL, 'for me alone'
  );
  ASSERT public._push_count() = v_before, 'TEST 6c FAILED: a private check-in on a habit done today pushed';
  RAISE NOTICE 'TEST 6c PASSED: a private check-in on a habit done today is silent';
END $$;
RESET role;

DO $$
DECLARE v_before INT := public._push_count();
BEGIN
  INSERT INTO public.completions (habit_id, user_id, completion_type, evidence_url, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'photo',
          'a2000000-0000-4000-8000-000000000002/a6000000-0000-4000-8000-000000000001/again.webp', now());
  ASSERT public._push_count() = v_before + 1, 'TEST 6d FAILED: a photo on a habit done today should push';
  ASSERT public._last_push()->>'title' = '🙏 Rae completed Pray again',
    format('TEST 6d FAILED: wrong title %s', public._last_push()->>'title');

  INSERT INTO public.completions (habit_id, user_id, completion_type, notes, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'message', 'and again at noon', now());
  ASSERT public._push_count() = v_before + 2, 'TEST 6e FAILED: a note on a habit done today should push';
  RAISE NOTICE 'TEST 6d-e PASSED: a photo or a note on a habit done today pushes, saying again';
END $$;

DO $$
DECLARE v_before INT := public._push_count();
BEGIN
  -- Skipped this morning, done after all: the check-in is the day's first.
  INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'rain_check', 'busy', now());
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'quick', now());
  ASSERT public._push_count() = v_before + 2, 'TEST 6f FAILED: expected the rain check''s push and the check-in''s';
  ASSERT public._last_push()->>'title' = '🚶 Rae completed Walk',
    format('TEST 6f FAILED: wrong title %s', public._last_push()->>'title');
  RAISE NOTICE 'TEST 6f PASSED: a rain check is not a check-in, so the one after it pushes as the first';
END $$;

DO $$
DECLARE v_before INT := public._push_count();
BEGIN
  -- Monday and Wednesday of last week: one step on the streak, two days' news.
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  SELECT 'a6000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'quick',
         ((today - EXTRACT(DOW FROM today)::int - 6) + time '12:00') AT TIME ZONE 'UTC'
  FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t;
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  SELECT 'a6000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'quick',
         ((today - EXTRACT(DOW FROM today)::int - 4) + time '12:00') AT TIME ZONE 'UTC'
  FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t;
  ASSERT public._push_count() = v_before + 2, 'TEST 6g FAILED: a weekly habit done on two days should push twice';
  ASSERT public._last_push()->>'title' = '🍞 Rae completed Fast',
    format('TEST 6g FAILED: wrong title %s', public._last_push()->>'title');
  RAISE NOTICE 'TEST 6g PASSED: a weekly habit done again on another day pushes as news';
END $$;

DO $$
BEGIN
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('a6000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'quick', now());
  ASSERT public._last_push()->>'title' = 'Rae completed Stretch',
    format('TEST 6h FAILED: a habit with no emoji pushed the title %s', coalesce(public._last_push()->>'title', 'NULL'));
  RAISE NOTICE 'TEST 6h PASSED: a habit with no emoji still pushes a title';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL REPEAT CHECK-IN TESTS PASSED ==='; END $$;

ROLLBACK;
