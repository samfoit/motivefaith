-- =============================================================================
-- A habit's time can differ by day (migration 045)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/day-time-windows.test.sql
--
-- time_window keeps a usual start and end, and a map of the days that differ:
-- their own window, or null for no set time. Reminders, missed alerts and a
-- partner's missed badge and inbox all read the day's window. Missed alerts
-- go only to partners who accepted and want them, once a day, and a weekly
-- habit is reminded until it is done that week and missed only when the week
-- ends without it.
--
-- Everything runs on a fixed week, Sunday 4 to Saturday 10 October 2026, in
-- UTC. pg_net is not installed on a local stack, so `net` is stubbed to
-- record the push the notify triggers would send. Everything is rolled back
-- at the end.
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

-- Who get_missed_habits would tell about a habit at a given moment.
CREATE FUNCTION public._told(p_habit UUID, p_at TIMESTAMPTZ) RETURNS TEXT[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(p.display_name ORDER BY p.display_name), '{}')
  FROM public.get_missed_habits(p_at) m
  JOIN public.profiles p ON p.id = m.partner_id
  WHERE m.habit_id = p_habit
$fn$;

-- The habits get_habits_due_for_reminder would remind about at a moment.
CREATE FUNCTION public._reminded(p_at TIMESTAMPTZ) RETURNS TEXT[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(r.title ORDER BY r.title), '{}')
  FROM public.get_habits_due_for_reminder(p_at) r
  WHERE r.user_id = 'd1000000-0000-4000-8000-000000000001'
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- olive  keeps every habit below, and has push on for her reminders
-- pat    partners on all of them: accepted, push on, no quiet hours
-- dee    declined to partner on Run
-- pen    was asked to partner on Run and has not answered
-- mia    partners on Run, but has turned Missed Habits off

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dtw-olive@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"dtw_olive"}'::jsonb, now(), now()),
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dtw-pat@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"dtw_pat"}'::jsonb,   now(), now()),
  ('d3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dtw-dee@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"dtw_dee"}'::jsonb,   now(), now()),
  ('d4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dtw-pen@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"dtw_pen"}'::jsonb,   now(), now()),
  ('d5000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dtw-mia@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"dtw_mia"}'::jsonb,   now(), now());

-- No quiet hours for anyone: is_in_quiet_hours reads the real clock, not the
-- moment a test asks about.
UPDATE public.profiles SET timezone = 'UTC', notification_prefs = '{}'::jsonb,
  display_name = CASE id
    WHEN 'd1000000-0000-4000-8000-000000000001' THEN 'Olive'
    WHEN 'd2000000-0000-4000-8000-000000000002' THEN 'Pat'
    WHEN 'd3000000-0000-4000-8000-000000000003' THEN 'Dee'
    WHEN 'd4000000-0000-4000-8000-000000000004' THEN 'Pen'
    WHEN 'd5000000-0000-4000-8000-000000000005' THEN 'Mia'
  END
WHERE id IN ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002',
             'd3000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000004',
             'd5000000-0000-4000-8000-000000000005');

UPDATE public.profiles SET notification_prefs = '{"miss_alerts": false}'::jsonb
WHERE id = 'd5000000-0000-4000-8000-000000000005';

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth) VALUES
  ('https://push.test/olive', 'd1000000-0000-4000-8000-000000000001', 'x', 'y'),
  ('https://push.test/pat',   'd2000000-0000-4000-8000-000000000002', 'x', 'y'),
  ('https://push.test/dee',   'd3000000-0000-4000-8000-000000000003', 'x', 'y'),
  ('https://push.test/pen',   'd4000000-0000-4000-8000-000000000004', 'x', 'y'),
  ('https://push.test/mia',   'd5000000-0000-4000-8000-000000000005', 'x', 'y');

-- Friends, so Pat can read Olive's profile in the inbox, as a partner always can.
INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'accepted');

-- Run   every day, 8 to 9 — but 4 to 5 at the weekend, and any time on Tuesday
-- Plain every day, 8 to 9, the same every day
-- Read  weekly, 8 to 9, done on Monday
-- Pray  weekly, 8 to 9, not done this week
INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule, time_window) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Run', '🏃', 'daily',
   '{"days":[0,1,2,3,4,5,6]}',
   '{"start":"08:00","end":"09:00","days":{"0":{"start":"16:00","end":"17:00"},"6":{"start":"16:00","end":"17:00"},"2":null}}'),
  ('e2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'Plain', NULL, 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('e3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'Read', '📚', 'weekly',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('e4000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', 'Pray', '🙏', 'weekly',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by)
SELECT h, 'd2000000-0000-4000-8000-000000000002', 'accepted', 'd1000000-0000-4000-8000-000000000001'
FROM unnest(ARRAY[
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000002',
  'e3000000-0000-4000-8000-000000000003',
  'e4000000-0000-4000-8000-000000000004'
]::uuid[]) AS h;

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000003', 'declined', 'd1000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000004', 'pending',  'd1000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000005', 'accepted', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('e3000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'quick', '2026-10-05 10:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: what a time window may hold
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad JSONB;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    '{"start":"08:00","end":"09:00","days":{"7":null}}',
    '{"start":"08:00","end":"09:00","days":{"sat":null}}',
    '{"start":"08:00","end":"09:00","days":{"6":{"start":"4pm","end":"17:00"}}}',
    '{"start":"08:00","end":"09:00","days":{"6":{"start":"16:00"}}}',
    '{"start":"08:00","end":"09:00","days":{"6":"16:00"}}',
    '{"start":"08:00","end":"09:00","days":[null]}',
    '{"start":"8","end":"09:00"}'
  ]::jsonb[] LOOP
    BEGIN
      UPDATE public.habits SET time_window = v_bad
      WHERE id = 'e2000000-0000-4000-8000-000000000002';
      RAISE EXCEPTION 'TEST 1 FAILED: % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- As the old CHECK did, a window missing an end still passes: rows like it
  -- may exist, and the new constraint had to take them.
  UPDATE public.habits SET time_window = '{"start":"08:00"}'
  WHERE id = 'e2000000-0000-4000-8000-000000000002';
  UPDATE public.habits SET time_window = '{"start":"08:00","end":"09:00"}'
  WHERE id = 'e2000000-0000-4000-8000-000000000002';

  RAISE NOTICE 'TEST 1 PASSED: malformed days are refused, and the usual window is checked as it always was';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the days stay in step with the habit
-- ---------------------------------------------------------------------------

INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window) VALUES
  ('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000001', 'Shape', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00","days":{}}');

DO $$
DECLARE
  v_tw JSONB;
BEGIN
  SELECT time_window INTO v_tw FROM public.habits WHERE id = 'e5000000-0000-4000-8000-000000000005';
  ASSERT NOT v_tw ? 'days',
    format('TEST 2a FAILED: an empty map should not be stored, got %s', v_tw);

  UPDATE public.habits
  SET time_window = '{"start":"08:00","end":"09:00","days":{"0":{"start":"16:00","end":"17:00"},"6":{"start":"16:00","end":"17:00"}}}'
  WHERE id = 'e5000000-0000-4000-8000-000000000005';

  -- An app from before 045 saves the habit — a rename, say — and sends the
  -- whole window, without days.
  UPDATE public.habits SET title = 'Shape up', time_window = '{"start":"07:00","end":"08:00"}'
  WHERE id = 'e5000000-0000-4000-8000-000000000005';
  SELECT time_window INTO v_tw FROM public.habits WHERE id = 'e5000000-0000-4000-8000-000000000005';
  ASSERT v_tw->>'start' = '07:00' AND v_tw->'days' ? '0' AND v_tw->'days' ? '6',
    format('TEST 2b FAILED: a write without days should keep the stored ones, got %s', v_tw);

  -- Sunday leaves the schedule, and its time goes with it.
  UPDATE public.habits SET schedule = '{"days":[1,2,3,4,5,6]}'
  WHERE id = 'e5000000-0000-4000-8000-000000000005';
  SELECT time_window INTO v_tw FROM public.habits WHERE id = 'e5000000-0000-4000-8000-000000000005';
  ASSERT NOT v_tw->'days' ? '0' AND v_tw->'days' ? '6',
    format('TEST 2c FAILED: only scheduled days should keep a time, got %s', v_tw);

  -- {} is how this build clears them.
  UPDATE public.habits SET time_window = '{"start":"07:00","end":"08:00","days":{}}'
  WHERE id = 'e5000000-0000-4000-8000-000000000005';
  SELECT time_window INTO v_tw FROM public.habits WHERE id = 'e5000000-0000-4000-8000-000000000005';
  ASSERT NOT v_tw ? 'days',
    format('TEST 2d FAILED: days: {} should clear them, got %s', v_tw);

  -- A weekly habit has no days of its own.
  UPDATE public.habits SET time_window = '{"start":"07:00","end":"08:00","days":{"6":null}}'
  WHERE id = 'e5000000-0000-4000-8000-000000000005';
  UPDATE public.habits SET frequency = 'weekly', schedule = '{"days":[0,1,2,3,4,5,6]}'
  WHERE id = 'e5000000-0000-4000-8000-000000000005';
  SELECT time_window INTO v_tw FROM public.habits WHERE id = 'e5000000-0000-4000-8000-000000000005';
  ASSERT NOT v_tw ? 'days',
    format('TEST 2e FAILED: a weekly habit should lose its days, got %s', v_tw);

  RAISE NOTICE 'TEST 2 PASSED: old builds keep the days, and they follow the schedule';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the window on a given day
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_tw JSONB;
BEGIN
  SELECT time_window INTO v_tw FROM public.habits WHERE id = 'e1000000-0000-4000-8000-000000000001';
  ASSERT public.habit_window_on(v_tw, 3) = '{"start":"08:00","end":"09:00"}'::jsonb,
    format('TEST 3 FAILED: Wednesday should be the usual window, got %s', public.habit_window_on(v_tw, 3));
  ASSERT public.habit_window_on(v_tw, 6) = '{"start":"16:00","end":"17:00"}'::jsonb,
    format('TEST 3 FAILED: Saturday should be its own, got %s', public.habit_window_on(v_tw, 6));
  ASSERT public.habit_window_on(v_tw, 2) IS NULL,
    'TEST 3 FAILED: Tuesday has no set time';
  ASSERT public.habit_window_on(NULL, 1) IS NULL,
    'TEST 3 FAILED: no window is no window on any day';
  RAISE NOTICE 'TEST 3 PASSED: a day reads its own window, or the usual one';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: reminders come at the day's own time
-- ---------------------------------------------------------------------------
-- A reminder goes out in the 15 minutes before the start.

DO $$
BEGIN
  -- Wednesday morning: Run and Plain at 8. Pray, weekly, is not done this
  -- week; Read was done on Monday, and is not reminded again.
  ASSERT public._reminded('2026-10-07 07:50+00') = ARRAY['Plain', 'Pray', 'Run'],
    format('TEST 4a FAILED: Wednesday 7:50 reminded %s', public._reminded('2026-10-07 07:50+00'));

  -- Saturday: Run waits for 4.
  ASSERT public._reminded('2026-10-10 07:50+00') = ARRAY['Plain', 'Pray'],
    format('TEST 4b FAILED: Saturday 7:50 reminded %s', public._reminded('2026-10-10 07:50+00'));
  ASSERT public._reminded('2026-10-10 15:50+00') = ARRAY['Run'],
    format('TEST 4c FAILED: Saturday 15:50 reminded %s', public._reminded('2026-10-10 15:50+00'));

  -- Tuesday: Run has no set time, so no reminder at all.
  ASSERT NOT 'Run' = ANY (public._reminded('2026-10-06 07:50+00')),
    'TEST 4d FAILED: a day with no set time was reminded';
  ASSERT NOT 'Run' = ANY (public._reminded('2026-10-06 15:50+00')),
    'TEST 4d FAILED: a day with no set time was reminded';

  RAISE NOTICE 'TEST 4 PASSED: reminders follow the day''s window, and a weekly habit done this week is left alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: who is told a habit was missed, and when
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_rows INT;
BEGIN
  -- Friday at 10, an hour after Run's usual window: only Pat. Dee declined,
  -- Pen never answered, Mia turned Missed Habits off.
  ASSERT public._told('e1000000-0000-4000-8000-000000000001', '2026-10-09 10:00+00') = ARRAY['Pat'],
    format('TEST 5a FAILED: Friday 10:00 told %s', public._told('e1000000-0000-4000-8000-000000000001', '2026-10-09 10:00+00'));

  -- Saturday at 10: Run's window runs until 5, so nobody yet.
  ASSERT public._told('e1000000-0000-4000-8000-000000000001', '2026-10-10 10:00+00') = '{}',
    'TEST 5b FAILED: Run was missed before its Saturday window';
  ASSERT public._told('e1000000-0000-4000-8000-000000000001', '2026-10-10 18:00+00') = ARRAY['Pat'],
    format('TEST 5b FAILED: Saturday 18:00 told %s', public._told('e1000000-0000-4000-8000-000000000001', '2026-10-10 18:00+00'));

  -- Tuesday has no set time: never missed.
  ASSERT public._told('e1000000-0000-4000-8000-000000000001', '2026-10-06 23:00+00') = '{}',
    'TEST 5c FAILED: a day with no set time was missed';

  -- The day is for the owner's date, and Pat is told once.
  ASSERT (SELECT owner_date FROM public.get_missed_habits('2026-10-10 18:00+00')
          WHERE habit_id = 'e1000000-0000-4000-8000-000000000001') = '2026-10-10',
    'TEST 5d FAILED: owner_date should be Saturday';
  UPDATE public.habit_shares SET last_miss_alert_date = '2026-10-10'
  WHERE habit_id = 'e1000000-0000-4000-8000-000000000001'
    AND shared_with = 'd2000000-0000-4000-8000-000000000002';
  ASSERT public._told('e1000000-0000-4000-8000-000000000001', '2026-10-10 19:00+00') = '{}',
    'TEST 5d FAILED: Pat was told again an hour later';
  ASSERT public._told('e2000000-0000-4000-8000-000000000002', '2026-10-10 19:00+00') = ARRAY['Pat'],
    'TEST 5d FAILED: being told about Run should not stop Pat hearing about Plain';

  -- Weekly: missed only when the week ends without it.
  ASSERT public._told('e4000000-0000-4000-8000-000000000004', '2026-10-09 10:00+00') = '{}',
    'TEST 5e FAILED: Pray was missed before its week was out';
  ASSERT public._told('e4000000-0000-4000-8000-000000000004', '2026-10-10 10:00+00') = ARRAY['Pat'],
    'TEST 5e FAILED: Pray should be missed on Saturday, with nothing this week';
  ASSERT public._told('e3000000-0000-4000-8000-000000000003', '2026-10-10 10:00+00') = '{}',
    'TEST 5e FAILED: Read was done on Monday, and is not missed';

  -- A check-in settles the day.
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('e2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'quick', '2026-10-08 20:00+00');
  ASSERT public._told('e2000000-0000-4000-8000-000000000002', '2026-10-08 22:00+00') = '{}',
    'TEST 5f FAILED: Plain was done on Thursday';

  RAISE NOTICE 'TEST 5 PASSED: missed alerts follow the day''s window, go to partners who want them, once';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a partner's inbox
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE
  v_morning TEXT[];
  v_evening TEXT[];
BEGIN
  SELECT array_agg(title ORDER BY title) INTO v_morning
  FROM public.get_inbox_missed_habits(
    'd2000000-0000-4000-8000-000000000002', '2026-10-10', 6,
    '2026-10-10 00:00+00', '2026-10-11 00:00+00', '10:00');
  ASSERT v_morning = ARRAY['Plain', 'Pray'],
    format('TEST 6 FAILED: Saturday 10:00 listed %s', v_morning);

  SELECT array_agg(title ORDER BY title) INTO v_evening
  FROM public.get_inbox_missed_habits(
    'd2000000-0000-4000-8000-000000000002', '2026-10-10', 6,
    '2026-10-10 00:00+00', '2026-10-11 00:00+00', '18:00');
  ASSERT v_evening = ARRAY['Plain', 'Pray', 'Run'],
    format('TEST 6 FAILED: Saturday 18:00 listed %s', v_evening);

  RAISE NOTICE 'TEST 6 PASSED: the inbox lists a habit once the day''s window has closed';
END $$;

RESET role;

-- ---------------------------------------------------------------------------
-- Test 7: a partner's missed badge reads today's window
-- ---------------------------------------------------------------------------
-- Count is a habit whose usual window never closes (it ends at 23:59, and
-- the comparison is strict). Today's own window, which ends at midnight,
-- has always closed — except in the first minute of the day.

INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window) VALUES
  ('e6000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000001', 'Count', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"23:58","end":"23:59"}');
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by)
VALUES ('e6000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000002', 'accepted', 'd1000000-0000-4000-8000-000000000001');

-- The count is for whoever auth.uid() names; it runs as its owner either way.
SET LOCAL request.jwt.claims TO '{"sub":"d2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE
  v_dow TEXT := EXTRACT(DOW FROM now() AT TIME ZONE 'UTC')::int::text;
  v_usual INT;
BEGIN
  v_usual := public.get_missed_habit_count('UTC');

  UPDATE public.habits
  SET time_window = jsonb_build_object('start', '23:58', 'end', '23:59',
        'days', jsonb_build_object(v_dow, jsonb_build_object('start', '00:00', 'end', '00:00')))
  WHERE id = 'e6000000-0000-4000-8000-000000000006';
  ASSERT public.get_missed_habit_count('UTC') = v_usual + 1,
    format('TEST 7 FAILED: today''s closed window should count, %s then %s',
           v_usual, public.get_missed_habit_count('UTC'));

  UPDATE public.habits
  SET time_window = jsonb_build_object('start', '23:58', 'end', '23:59',
        'days', jsonb_build_object(v_dow, NULL))
  WHERE id = 'e6000000-0000-4000-8000-000000000006';
  ASSERT public.get_missed_habit_count('UTC') = v_usual,
    'TEST 7 FAILED: a day with no set time should not count';

  RAISE NOTICE 'TEST 7 PASSED: the missed badge reads today''s window';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: only the edge function can ask who to tell
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.get_missed_habits(timestamptz)', 'EXECUTE'),
    'TEST 8 FAILED: anon can list every partner to tell';
  ASSERT NOT has_function_privilege('authenticated', 'public.get_missed_habits(timestamptz)', 'EXECUTE'),
    'TEST 8 FAILED: any signed-in user can list every partner to tell';
  ASSERT has_function_privilege('service_role', 'public.get_missed_habits(timestamptz)', 'EXECUTE'),
    'TEST 8 FAILED: check-missed-habits can no longer call it';
  RAISE NOTICE 'TEST 8 PASSED: get_missed_habits is the service role''s alone';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL DAY TIME WINDOW TESTS PASSED ==='; END $$;

ROLLBACK;
