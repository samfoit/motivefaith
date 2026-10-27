-- =============================================================================
-- Pausing a habit (migration 047)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/habit-pauses.test.sql
--
-- A pause is kept as a span of days, and the streak steps over it the way it
-- steps over a day off the schedule: resuming picks the streak up where it
-- was left, however long the pause ran. A miss before the pause is still a
-- miss. And a paused habit takes no check-ins — not from the app, a private
-- check-in, the capture flow or the table itself — while the offline batch
-- drops a paused habit's and keeps the rest.
--
-- pg_net is not installed on a local stack, so `net` is stubbed to record the
-- push the notify trigger would send. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

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

-- The owner's today, which every date below counts from.
CREATE FUNCTION public._today() RETURNS DATE
LANGUAGE sql AS $fn$ SELECT (now() AT TIME ZONE 'UTC')::date $fn$;

-- Noon, n days ago: always that day, whatever the hour now.
CREATE FUNCTION public._days_ago(n INT) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $fn$ SELECT ((public._today() - n) + time '12:00') AT TIME ZONE 'UTC' $fn$;

CREATE FUNCTION public._streak(p_habit UUID) RETURNS INT
LANGUAGE sql AS $fn$ SELECT streak_current FROM public.habits WHERE id = p_habit $fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- ora       keeps every habit below
-- pat       partners on Swim, with pushes on and no quiet hours
-- stranger  no relationship to anyone

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hp-ora@test.com',      crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"hp_ora"}'::jsonb,      now(), now()),
  ('e2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hp-pat@test.com',      crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"hp_pat"}'::jsonb,      now(), now()),
  ('e3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hp-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"hp_stranger"}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Ora', timezone = 'UTC'
WHERE id = 'e1000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET display_name = 'Pat', timezone = 'UTC', notification_prefs = '{}'::jsonb
WHERE id = 'e2000000-0000-4000-8000-000000000002';
UPDATE public.profiles SET timezone = 'UTC'
WHERE id = 'e3000000-0000-4000-8000-000000000003';

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ('https://push.test/pat', 'e2000000-0000-4000-8000-000000000002', 'x', 'y');

INSERT INTO public.habits (id, user_id, title, frequency, schedule, created_at) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Water',   'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Swim',    'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'Run',     'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 'Walk',    'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 'Read',    'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001', 'Pray',    'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000001', 'Fast',    'weekly', '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000008', 'e1000000-0000-4000-8000-000000000001', 'Call',    'weekly', '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-000000000009', 'e1000000-0000-4000-8000-000000000001', 'Stretch', 'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days'),
  ('e5000000-0000-4000-8000-00000000000a', 'e1000000-0000-4000-8000-000000000001', 'Psalm',   'daily',  '{"days":[0,1,2,3,4,5,6]}', now() - interval '60 days');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, notify_complete)
VALUES ('e5000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'accepted', 'e1000000-0000-4000-8000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Test 1: pausing and resuming keep the span of days paused
-- ---------------------------------------------------------------------------

UPDATE public.habits SET is_paused = true WHERE id = 'e5000000-0000-4000-8000-000000000001';

DO $$
DECLARE p RECORD;
BEGIN
  ASSERT (SELECT count(*) FROM public.habit_pauses WHERE habit_id = 'e5000000-0000-4000-8000-000000000001') = 1,
    'TEST 1a FAILED: pausing should record one pause';
  SELECT started_on, ended_on INTO p FROM public.habit_pauses
    WHERE habit_id = 'e5000000-0000-4000-8000-000000000001';
  ASSERT p.started_on = public._today() AND p.ended_on IS NULL,
    format('TEST 1a FAILED: expected an open pause from today, got %s to %s', p.started_on, p.ended_on);
  RAISE NOTICE 'TEST 1a PASSED: pausing opens a pause from today';
END $$;

UPDATE public.habits SET is_paused = false WHERE id = 'e5000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.habit_pauses WHERE habit_id = 'e5000000-0000-4000-8000-000000000001'),
    'TEST 1b FAILED: a pause resumed the same day covered no day, and should be gone';
  RAISE NOTICE 'TEST 1b PASSED: resumed the same day, nothing was paused';
END $$;

-- Done today, then paused: today stays a done day.
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('e5000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'quick', now());
UPDATE public.habits SET is_paused = true WHERE id = 'e5000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  ASSERT (SELECT started_on FROM public.habit_pauses
          WHERE habit_id = 'e5000000-0000-4000-8000-000000000001' AND ended_on IS NULL) = public._today() + 1,
    'TEST 1c FAILED: a habit done today should be paused from tomorrow';
  RAISE NOTICE 'TEST 1c PASSED: a day already done is left out of the pause';
END $$;

-- Paused three days ago, back today.
UPDATE public.habit_pauses SET started_on = public._today() - 3
WHERE habit_id = 'e5000000-0000-4000-8000-000000000001';
UPDATE public.habits SET is_paused = false WHERE id = 'e5000000-0000-4000-8000-000000000001';

DO $$
DECLARE p RECORD;
BEGIN
  SELECT started_on, ended_on INTO p FROM public.habit_pauses
    WHERE habit_id = 'e5000000-0000-4000-8000-000000000001';
  ASSERT p.started_on = public._today() - 3 AND p.ended_on = public._today(),
    format('TEST 1d FAILED: expected three days ago up to today, got %s to %s', p.started_on, p.ended_on);
  RAISE NOTICE 'TEST 1d PASSED: resuming closes the pause, and today is tracked again';
END $$;

INSERT INTO public.habits (id, user_id, title, frequency, schedule, is_paused) VALUES
  ('e5000000-0000-4000-8000-00000000000b', 'e1000000-0000-4000-8000-000000000001', 'Created paused', 'daily', '{"days":[0,1,2,3,4,5,6]}', true);

DO $$
BEGIN
  ASSERT (SELECT started_on FROM public.habit_pauses
          WHERE habit_id = 'e5000000-0000-4000-8000-00000000000b' AND ended_on IS NULL) = public._today(),
    'TEST 1e FAILED: a habit created paused should be paused from today';
  RAISE NOTICE 'TEST 1e PASSED: a habit created paused is paused from the start';
END $$;

-- Only the owner reads them, and nobody writes them by hand.
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.habit_pauses) = 2,
    'TEST 1f FAILED: the owner should read their own two pauses';
  BEGIN
    INSERT INTO public.habit_pauses (habit_id, started_on)
    VALUES ('e5000000-0000-4000-8000-000000000003', public._today() - 30);
    RAISE EXCEPTION 'TEST 1f FAILED: the owner wrote a pause by hand';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.habit_pauses) = 0,
    'TEST 1f FAILED: a stranger read someone else''s pauses';
  RAISE NOTICE 'TEST 1f PASSED: pauses are the owner''s to read, and nobody''s to write';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 2: a paused habit takes no check-ins
-- ---------------------------------------------------------------------------

UPDATE public.habits SET is_paused = true WHERE id = 'e5000000-0000-4000-8000-000000000002';

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT public.insert_completion('e5000000-0000-4000-8000-000000000002', 'quick')$q$,
    $q$SELECT public.insert_completion('e5000000-0000-4000-8000-000000000002', 'rain_check', NULL, NULL, 'busy')$q$,
    $q$SELECT public.insert_private_completion('e5000000-0000-4000-8000-000000000002', 'message', NULL, 'for me')$q$,
    $q$SELECT public.share_capture('e1000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000002/take.webp', 'photo', NULL, ARRAY['e5000000-0000-4000-8000-000000000002']::uuid[])$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 2a FAILED: a paused habit took %', call;
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'TEST 2a PASSED: a check-in, a rain check, a private check-in and a capture are all refused as paused';
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.completions (habit_id, user_id, completion_type)
    VALUES ('e5000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'quick');
    RAISE EXCEPTION 'TEST 2b FAILED: a paused habit took a check-in straight into the table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'TEST 2b PASSED: nor straight into the table';
END $$;

-- The offline queue: one queued for the paused habit, one for a live one.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.insert_completions_batch(
    '[{"habit_id":"e5000000-0000-4000-8000-000000000002","completion_type":"quick"},
      {"habit_id":"e5000000-0000-4000-8000-00000000000a","completion_type":"message","notes":"queued offline"}]'::jsonb);
  ASSERT n = 1, format('TEST 2c FAILED: expected only the live habit''s check-in back, got %s', n);
END $$;
RESET role;

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.completions WHERE habit_id = 'e5000000-0000-4000-8000-000000000002'),
    'TEST 2c FAILED: the paused habit got a check-in from the batch';
  ASSERT (SELECT count(*) FROM public.completions WHERE habit_id = 'e5000000-0000-4000-8000-00000000000a') = 1,
    'TEST 2c FAILED: the live habit''s check-in was held back with it';
  RAISE NOTICE 'TEST 2c PASSED: the offline batch drops the paused habit''s check-in and keeps the rest';

  ASSERT NOT EXISTS (SELECT 1 FROM public._sent_push WHERE body->>'user_id' = 'e2000000-0000-4000-8000-000000000002'),
    'TEST 2d FAILED: a partner was told about a paused habit';
  ASSERT public._streak('e5000000-0000-4000-8000-000000000002') = 0,
    'TEST 2d FAILED: the paused habit''s streak moved';
  RAISE NOTICE 'TEST 2d PASSED: nothing moved the paused habit''s streak or reached its partner';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: resumed, the streak is where the pause left it
-- ---------------------------------------------------------------------------
-- Run and Walk: done 8, 7 and 6 days ago. Run was paused from 5 days ago and
-- is back today; Walk just stopped.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'e1000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY['e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000004']::uuid[]) AS h,
     unnest(ARRAY[8, 7, 6]) AS n
ORDER BY h, n DESC;

INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('e5000000-0000-4000-8000-000000000003', public._today() - 5, public._today());

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000003') = 3,
    format('TEST 3a FAILED: the sweep took the paused days for misses, streak %s', public._streak('e5000000-0000-4000-8000-000000000003'));
  ASSERT public._streak('e5000000-0000-4000-8000-000000000004') = 0,
    format('TEST 3a FAILED: without a pause the same days are misses, streak %s', public._streak('e5000000-0000-4000-8000-000000000004'));
  RAISE NOTICE 'TEST 3a PASSED: the sweep steps over a pause, and still ends a streak that just stopped';
END $$;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$ BEGIN PERFORM public.insert_completion('e5000000-0000-4000-8000-000000000003', 'quick'); END $$;
RESET role;

DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000003') = 4,
    format('TEST 3b FAILED: the first check-in back should make it 4, got %s', public._streak('e5000000-0000-4000-8000-000000000003'));
  RAISE NOTICE 'TEST 3b PASSED: the first check-in back carries the streak on';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: however long the pause ran
-- ---------------------------------------------------------------------------
-- Done 45, 44 and 43 days ago, then paused for 42 days: past the 14 days the
-- walk back searches and the 30 the covered-day look used to stop at.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'e5000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[45, 44, 43]) AS n
ORDER BY n DESC;

INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('e5000000-0000-4000-8000-000000000005', public._today() - 42, public._today());

SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000005') = 3,
    format('TEST 4 FAILED: the sweep broke a streak across a long pause, streak %s', public._streak('e5000000-0000-4000-8000-000000000005'));
  PERFORM public.insert_completion('e5000000-0000-4000-8000-000000000005', 'quick');
  ASSERT public._streak('e5000000-0000-4000-8000-000000000005') = 4,
    format('TEST 4 FAILED: the first check-in after a long pause should make it 4, got %s', public._streak('e5000000-0000-4000-8000-000000000005'));
  RAISE NOTICE 'TEST 4 PASSED: a six-week pause is stepped over whole';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 5: a miss before the pause is still a miss
-- ---------------------------------------------------------------------------
-- Done 9 and 8 days ago, missed 7 days ago, paused from 6 days ago.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'e5000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[9, 8]) AS n
ORDER BY n DESC;

INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('e5000000-0000-4000-8000-000000000006', public._today() - 6, public._today());

SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000006') = 0,
    format('TEST 5 FAILED: a pause excused the day missed before it, streak %s', public._streak('e5000000-0000-4000-8000-000000000006'));
  PERFORM public.insert_completion('e5000000-0000-4000-8000-000000000006', 'quick');
  ASSERT public._streak('e5000000-0000-4000-8000-000000000006') = 1,
    format('TEST 5 FAILED: the check-in after should start over at 1, got %s', public._streak('e5000000-0000-4000-8000-000000000006'));
  RAISE NOTICE 'TEST 5 PASSED: pausing after a miss does not excuse it';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 6: a weekly habit's paused weeks are stepped over
-- ---------------------------------------------------------------------------
-- Fast and Call: done on the Monday of the fourth and third weeks back. Fast
-- was paused from the Wednesday two weeks back until this Sunday, so both
-- of the last two Saturdays were paused; Call just stopped.

-- One statement per week: update_streak() reads a weekly habit's week as
-- everything from its Sunday on, so a later row in the same statement would
-- already be there when the earlier one is counted.
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'e1000000-0000-4000-8000-000000000001', 'quick',
       ((sun - 27) + time '12:00') AT TIME ZONE 'UTC'
FROM (SELECT public._today() - EXTRACT(DOW FROM public._today())::int AS sun) s,
     unnest(ARRAY['e5000000-0000-4000-8000-000000000007', 'e5000000-0000-4000-8000-000000000008']::uuid[]) AS h;

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h, 'e1000000-0000-4000-8000-000000000001', 'quick',
       ((sun - 20) + time '12:00') AT TIME ZONE 'UTC'
FROM (SELECT public._today() - EXTRACT(DOW FROM public._today())::int AS sun) s,
     unnest(ARRAY['e5000000-0000-4000-8000-000000000007', 'e5000000-0000-4000-8000-000000000008']::uuid[]) AS h;

INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
SELECT 'e5000000-0000-4000-8000-000000000007', sun - 11, sun
FROM (SELECT public._today() - EXTRACT(DOW FROM public._today())::int AS sun) s;

DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000007') = 2,
    format('TEST 6 SETUP FAILED: expected two weeks running, got %s', public._streak('e5000000-0000-4000-8000-000000000007'));
END $$;

SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000007') = 2,
    format('TEST 6a FAILED: the sweep took paused weeks for misses, streak %s', public._streak('e5000000-0000-4000-8000-000000000007'));
  ASSERT public._streak('e5000000-0000-4000-8000-000000000008') = 0,
    format('TEST 6a FAILED: without a pause the same weeks are misses, streak %s', public._streak('e5000000-0000-4000-8000-000000000008'));
  RAISE NOTICE 'TEST 6a PASSED: the weekly sweep steps over paused weeks, and still ends one that stopped';

  PERFORM public.insert_completion('e5000000-0000-4000-8000-000000000007', 'quick');
  ASSERT public._streak('e5000000-0000-4000-8000-000000000007') = 3,
    format('TEST 6b FAILED: the first week back should make it 3, got %s', public._streak('e5000000-0000-4000-8000-000000000007'));
  RAISE NOTICE 'TEST 6b PASSED: the first week back carries a weekly streak on';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 7: paused and resumed through the flag, as the app does it
-- ---------------------------------------------------------------------------
-- Done 6, 5 and 4 days ago, then paused. The pause is moved to have begun 3
-- days ago, the day after the last check-in, as if it had been set then.

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'e5000000-0000-4000-8000-000000000009', 'e1000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[6, 5, 4]) AS n
ORDER BY n DESC;

UPDATE public.habits SET is_paused = true WHERE id = 'e5000000-0000-4000-8000-000000000009';
UPDATE public.habit_pauses SET started_on = public._today() - 3
WHERE habit_id = 'e5000000-0000-4000-8000-000000000009';

SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000009') = 3,
    format('TEST 7a FAILED: the sweep touched a paused habit, streak %s', public._streak('e5000000-0000-4000-8000-000000000009'));
  RAISE NOTICE 'TEST 7a PASSED: while paused, the sweep leaves the streak alone';
END $$;

UPDATE public.habits SET is_paused = false WHERE id = 'e5000000-0000-4000-8000-000000000009';
SELECT public.reset_stale_streaks();

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._streak('e5000000-0000-4000-8000-000000000009') = 3,
    format('TEST 7b FAILED: resumed, the next sweep broke the streak, streak %s', public._streak('e5000000-0000-4000-8000-000000000009'));
  PERFORM public.insert_completion('e5000000-0000-4000-8000-000000000009', 'quick');
  ASSERT public._streak('e5000000-0000-4000-8000-000000000009') = 4,
    format('TEST 7b FAILED: the first check-in back should make it 4, got %s', public._streak('e5000000-0000-4000-8000-000000000009'));
  RAISE NOTICE 'TEST 7b PASSED: resumed, the streak survives the sweep and carries on';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 8: pauses back to back are stepped over together
-- ---------------------------------------------------------------------------

INSERT INTO public.habit_pauses (habit_id, started_on, ended_on) VALUES
  ('e5000000-0000-4000-8000-00000000000a', public._today() - 10, public._today() - 6),
  ('e5000000-0000-4000-8000-00000000000a', public._today() - 6,  public._today());

DO $$
DECLARE v_day DATE;
BEGIN
  v_day := public.habit_last_due_day('e5000000-0000-4000-8000-00000000000a', '[0,1,2,3,4,5,6]'::jsonb, public._today());
  ASSERT v_day = public._today() - 11,
    format('TEST 8 FAILED: expected the day before both pauses, got %s', v_day);
  RAISE NOTICE 'TEST 8 PASSED: pauses back to back are stepped over together';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL HABIT PAUSE TESTS PASSED ==='; END $$;

ROLLBACK;
