-- =============================================================================
-- When a missed habit is told, and when it is reminded (migration 048)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/missed-alert-timing.test.sql
--
-- A run tells partners about the owner's today, or about yesterday when that
-- is the latest missed day nobody has been told about: a window that closed
-- at 11 PM or later, after the last run of the day, or one a partner slept
-- through. A window is told only if it closed after the habit's timing was
-- set and after the partner became one, and never on a paused day. A change
-- to the timing re-arms the day's reminder. A stored time must be a time of
-- day, and one that is not is passed over rather than failing every user.
--
-- Dropping a habit's time ends its reminders and missed alerts and leaves
-- its streak alone. Weekly habits are pinned as they are: with no time,
-- nothing is pushed; with one, they are reminded each day until done that
-- week and missed once, on Saturday.
--
-- Missed alerts and reminders run on a fixed week, Sunday 4 to Saturday 10
-- October 2026: Thursday is the 8th, Friday the 9th. Times are UTC unless a
-- test says otherwise. Streak checks count back from the real today, as the
-- sweep does. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Weekly habits stand here for ones kept weekly before 052, whose weeks are
-- still judged as weekly. 052 refuses new ones; this rolls back with the rest.
ALTER TABLE public.habits DROP CONSTRAINT IF EXISTS chk_habit_not_weekly;

-- Who get_missed_habits would tell about a habit at a moment, and about which
-- of the owner's days: {"Pat@2026-10-08"}.
CREATE FUNCTION public._told(p_habit UUID, p_at TIMESTAMPTZ) RETURNS TEXT[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(p.display_name || '@' || m.owner_date ORDER BY p.display_name), '{}')
  FROM public.get_missed_habits(p_at) m
  JOIN public.profiles p ON p.id = m.partner_id
  WHERE m.habit_id = p_habit
$fn$;

-- The runs, every quarter hour from p_from to p_to, that would remind about
-- a habit, as local "HH:MI" in UTC.
CREATE FUNCTION public._reminded(p_habit UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS TEXT[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(to_char(t AT TIME ZONE 'UTC', 'Dy HH24:MI') ORDER BY t), '{}')
  FROM generate_series(p_from, p_to, interval '15 minutes') t
  WHERE EXISTS (SELECT 1 FROM public.get_habits_due_for_reminder(t) r WHERE r.id = p_habit)
$fn$;

CREATE FUNCTION public._today() RETURNS DATE
LANGUAGE sql AS $fn$ SELECT (now() AT TIME ZONE 'UTC')::date $fn$;

CREATE FUNCTION public._days_ago(n INT) RETURNS TIMESTAMPTZ
LANGUAGE sql AS $fn$ SELECT ((public._today() - n) + time '12:00') AT TIME ZONE 'UTC' $fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- olive  keeps the habits, in UTC, with push on for her reminders
-- kiran  keeps one habit, in India, where the hourly run falls at :30
-- pat    partners on everything: accepted, push on, no quiet hours
-- quinn  partners on Late, and is asleep when a test says so
-- newt   becomes a partner partway through the week
-- bea    partners on Badge alone, for the badge's count

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('ac000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mat-olive@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"mat_olive"}'::jsonb, now(), now()),
  ('ac000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mat-kiran@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"mat_kiran"}'::jsonb, now(), now()),
  ('ac000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mat-pat@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"mat_pat"}'::jsonb,   now(), now()),
  ('ac000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mat-quinn@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"mat_quinn"}'::jsonb, now(), now()),
  ('ac000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mat-newt@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"mat_newt"}'::jsonb,  now(), now()),
  ('ac000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mat-bea@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"mat_bea"}'::jsonb,   now(), now());

UPDATE public.profiles SET timezone = 'UTC', notification_prefs = '{}'::jsonb,
  display_name = CASE id
    WHEN 'ac000000-0000-4000-8000-000000000001' THEN 'Olive'
    WHEN 'ac000000-0000-4000-8000-000000000002' THEN 'Kiran'
    WHEN 'ac000000-0000-4000-8000-000000000003' THEN 'Pat'
    WHEN 'ac000000-0000-4000-8000-000000000004' THEN 'Quinn'
    WHEN 'ac000000-0000-4000-8000-000000000005' THEN 'Newt'
    WHEN 'ac000000-0000-4000-8000-000000000006' THEN 'Bea'
  END
WHERE id::text LIKE 'ac000000-%';
UPDATE public.profiles SET timezone = 'Asia/Kolkata'
WHERE id = 'ac000000-0000-4000-8000-000000000002';

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
SELECT 'https://push.test/' || id, id, 'x', 'y'
FROM public.profiles WHERE id::text LIKE 'ac000000-%';

-- Every habit dates from before the week, unless a test gives it a moment.
INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at)
SELECT h.id::uuid, coalesce(h.owner, 'ac000000-0000-4000-8000-000000000001')::uuid, h.title,
       h.frequency::habit_frequency, h.schedule::jsonb, h.tw::jsonb, '2026-10-01 00:00+00'
FROM (VALUES
  ('ad000000-0000-4000-8000-000000000001', NULL, 'Late',          'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"23:30"}'),
  ('ad000000-0000-4000-8000-000000000002', NULL, 'Eleven',        'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"23:00"}'),
  ('ad000000-0000-4000-8000-000000000003', NULL, 'Before eleven', 'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"22:59"}'),
  ('ad000000-0000-4000-8000-000000000004', NULL, 'Last minute',   'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"23:58","end":"23:59"}'),
  ('ad000000-0000-4000-8000-000000000005', 'ac000000-0000-4000-8000-000000000002',
                                                 'Kolkata',       'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"23:45"}'),
  ('ad000000-0000-4000-8000-000000000006', NULL, 'Vigil',         'weekly', '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"23:30"}'),
  ('ad000000-0000-4000-8000-000000000007', NULL, 'Kept vigil',    'weekly', '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"23:30"}'),
  ('ad000000-0000-4000-8000-000000000008', NULL, 'Done late',     'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"22:00","end":"23:30"}'),
  ('ad000000-0000-4000-8000-000000000009', NULL, 'Twice',         'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-00000000000a', NULL, 'Rest',          'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-00000000000b', NULL, 'Added',         'daily',  '{"days":[0,1,2,3,4,5,6]}', NULL),
  ('ad000000-0000-4000-8000-00000000000c', NULL, 'Earlier',       'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"18:00","end":"19:00"}'),
  ('ad000000-0000-4000-8000-00000000000d', NULL, 'Later',         'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-00000000000e', NULL, 'Onto today',    'specific_days', '{"days":[1,3,5]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-00000000000f', NULL, 'Morning',       'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-000000000010', NULL, 'Dropped',       'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-000000000011', NULL, 'Read',          'weekly', '{"days":[0,1,2,3,4,5,6]}', NULL),
  ('ad000000-0000-4000-8000-000000000012', NULL, 'Call',          'weekly', '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-000000000013', NULL, 'Moved',         'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}'),
  ('ad000000-0000-4000-8000-000000000014', NULL, 'Odd minute',    'daily',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"09:07","end":"10:00"}')
) AS h(id, owner, title, frequency, schedule, tw);

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at)
SELECT h.id, 'ac000000-0000-4000-8000-000000000003', 'accepted', h.user_id, '2026-10-01 00:00+00'
FROM public.habits h WHERE h.id::text LIKE 'ad000000-%';

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at)
VALUES ('ad000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000004', 'accepted',
        'ac000000-0000-4000-8000-000000000001', '2026-10-01 00:00+00');

-- Pat and Quinn have heard about every day missed before Thursday, as they
-- would have by now: the tests are about Thursday on.
UPDATE public.habit_shares SET last_miss_alert_date = '2026-10-07'
WHERE habit_id::text LIKE 'ad000000-%';

-- Friends, so Pat and Newt can read Olive's profile in the inbox, as a
-- partner always can.
INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003', 'accepted'),
  ('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000005', 'accepted');

-- ---------------------------------------------------------------------------
-- Test 1: a stored time is a time of day
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_bad JSONB;
BEGIN
  FOREACH v_bad IN ARRAY ARRAY[
    '{"start":"99:99","end":"23:00"}',
    '{"start":"08:00","end":"24:00"}',
    '{"start":"08:60","end":"09:00"}',
    '{"start":"08:00","end":"09:00","days":{"6":{"start":"25:00","end":"26:00"}}}'
  ]::jsonb[] LOOP
    BEGIN
      UPDATE public.habits SET time_window = v_bad
      WHERE id = 'ad000000-0000-4000-8000-000000000013';
      RAISE EXCEPTION 'TEST 1a FAILED: % was accepted', v_bad;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  UPDATE public.habits SET time_window = '{"start":"00:00","end":"23:59"}'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  UPDATE public.habits SET time_window = '{"start":"08:00","end":"09:00"}'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';

  RAISE NOTICE 'TEST 1a PASSED: hours past 23 and minutes past 59 are refused, midnight to 23:59 is not';
END $$;

-- A row saved before 048, when any two digits passed. Reminders cast the
-- start to a time, and one such habit made every user's reminders fail.
ALTER TABLE public.habits DROP CONSTRAINT valid_time_window;
INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at) VALUES
  ('ad000000-0000-4000-8000-0000000000ff', 'ac000000-0000-4000-8000-000000000001', 'Garbled', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"99:99","end":"99:99"}', '2026-10-01 00:00+00');
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at)
VALUES ('ad000000-0000-4000-8000-0000000000ff', 'ac000000-0000-4000-8000-000000000003', 'accepted',
        'ac000000-0000-4000-8000-000000000001', '2026-10-01 00:00+00');
ALTER TABLE public.habits ADD CONSTRAINT valid_time_window
  CHECK (public.is_valid_time_window(time_window)) NOT VALID;

DO $$
BEGIN
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000003', '2026-10-08 21:00+00', '2026-10-08 22:45+00') = ARRAY['Thu 22:00'],
    'TEST 1b FAILED: a habit stored with 99:99 stopped another habit''s reminder';
  ASSERT public._reminded('ad000000-0000-4000-8000-0000000000ff', '2026-10-08 00:00+00', '2026-10-08 23:45+00') = '{}',
    'TEST 1b FAILED: a start that is not a time was reminded';
  ASSERT public._told('ad000000-0000-4000-8000-0000000000ff', '2026-10-09 00:00+00') = '{}',
    'TEST 1b FAILED: an end that is not a time was told missed';
  ASSERT public._told('ad000000-0000-4000-8000-000000000003', '2026-10-08 23:00+00') = ARRAY['Pat@2026-10-08'],
    'TEST 1b FAILED: a habit stored with 99:99 stopped another habit''s missed alert';
  RAISE NOTICE 'TEST 1b PASSED: a time stored before 048 that is not one is passed over, and the rest still run';
END $$;

DELETE FROM public.habits WHERE id = 'ad000000-0000-4000-8000-0000000000ff';

-- ---------------------------------------------------------------------------
-- Test 2: a window that closes at 11 PM or later is told after midnight
-- ---------------------------------------------------------------------------
-- The check runs on the hour. At 11 PM a window that closes at 11 has not
-- closed — the comparison is to the minute and strict — and by the next run
-- the owner's day is over.

DO $$
DECLARE
  r RECORD;
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-000000000001', '2026-10-08 23:00+00') = '{}',
    'TEST 2a FAILED: Late (until 11:30 PM) was told before it closed';
  ASSERT public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 00:00+00') = ARRAY['Pat@2026-10-08', 'Quinn@2026-10-08'],
    format('TEST 2a FAILED: Late should be told at midnight about Thursday, told %s',
           public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 00:00+00'));
  SELECT owner_date, owner_today INTO r FROM public.get_missed_habits('2026-10-09 00:00+00')
  WHERE habit_id = 'ad000000-0000-4000-8000-000000000001' AND partner_id = 'ac000000-0000-4000-8000-000000000003';
  ASSERT r.owner_date = '2026-10-08' AND r.owner_today = '2026-10-09',
    format('TEST 2a FAILED: expected Thursday missed, asked on Friday, got %s on %s', r.owner_date, r.owner_today);
  RAISE NOTICE 'TEST 2a PASSED: a window closing at 11:30 PM is told at midnight, as yesterday''s';

  ASSERT public._told('ad000000-0000-4000-8000-000000000002', '2026-10-08 23:00+00') = '{}',
    'TEST 2b FAILED: Eleven was told at 11 PM, the minute it closed';
  ASSERT public._told('ad000000-0000-4000-8000-000000000002', '2026-10-09 00:00+00') = ARRAY['Pat@2026-10-08'],
    'TEST 2b FAILED: Eleven (until 11 PM) should be told at midnight';
  ASSERT public._told('ad000000-0000-4000-8000-000000000004', '2026-10-09 00:00+00') = ARRAY['Pat@2026-10-08'],
    'TEST 2b FAILED: Last minute (until 11:59 PM) should be told at midnight';
  RAISE NOTICE 'TEST 2b PASSED: windows ending at 11 PM and 11:59 PM are told at midnight';

  ASSERT public._told('ad000000-0000-4000-8000-000000000003', '2026-10-08 23:00+00') = ARRAY['Pat@2026-10-08'],
    'TEST 2c FAILED: Before eleven (until 10:59 PM) should be told at 11 PM, the same day';
  RAISE NOTICE 'TEST 2c PASSED: a window ending before 11 PM is still told that day';

  -- India is UTC+5:30: the run at 18:00 UTC is 11:30 PM there, the next at
  -- half past midnight.
  ASSERT public._told('ad000000-0000-4000-8000-000000000005', '2026-10-08 18:00+00') = '{}',
    'TEST 2d FAILED: Kolkata (until 11:45 PM IST) was told before it closed';
  ASSERT public._told('ad000000-0000-4000-8000-000000000005', '2026-10-08 19:00+00') = ARRAY['Pat@2026-10-08'],
    format('TEST 2d FAILED: Kolkata should be told at 12:30 AM IST about Thursday, told %s',
           public._told('ad000000-0000-4000-8000-000000000005', '2026-10-08 19:00+00'));
  RAISE NOTICE 'TEST 2d PASSED: where the run falls at :30, a window closing at 11:45 PM is told after midnight';

  -- Done at 11:15 PM: done, however late.
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('ad000000-0000-4000-8000-000000000008', 'ac000000-0000-4000-8000-000000000001', 'quick', '2026-10-08 23:15+00');
  ASSERT public._told('ad000000-0000-4000-8000-000000000008', '2026-10-09 00:00+00') = '{}',
    'TEST 2e FAILED: a habit done at 11:15 PM was told missed at midnight';
  RAISE NOTICE 'TEST 2e PASSED: done before midnight, a late window is not missed';

  -- Weekly: Saturday's window closes at 11:30 PM, so the week is told on
  -- Sunday at midnight — about Saturday, and only with nothing that week.
  INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
  VALUES ('ad000000-0000-4000-8000-000000000007', 'ac000000-0000-4000-8000-000000000001', 'quick', '2026-10-07 12:00+00');
  ASSERT public._told('ad000000-0000-4000-8000-000000000006', '2026-10-10 23:00+00') = '{}',
    'TEST 2f FAILED: Vigil was told before Saturday''s window closed';
  ASSERT public._told('ad000000-0000-4000-8000-000000000006', '2026-10-11 00:00+00') = ARRAY['Pat@2026-10-10'],
    format('TEST 2f FAILED: Vigil should be told on Sunday at midnight about Saturday, told %s',
           public._told('ad000000-0000-4000-8000-000000000006', '2026-10-11 00:00+00'));
  ASSERT public._told('ad000000-0000-4000-8000-000000000007', '2026-10-11 00:00+00') = '{}',
    'TEST 2f FAILED: Kept vigil was done on Wednesday, and was told missed';
  ASSERT public._told('ad000000-0000-4000-8000-000000000006', '2026-10-09 00:00+00') = '{}',
    'TEST 2f FAILED: a weekly habit was told after a Thursday';
  RAISE NOTICE 'TEST 2f PASSED: a weekly habit''s late Saturday window is told on Sunday at midnight';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a partner asleep when a window closes hears in the morning
-- ---------------------------------------------------------------------------
-- is_in_quiet_hours reads the real clock, so Quinn's quiet hours are set
-- around it, and taken off again for the morning.

UPDATE public.profiles
SET notification_prefs = jsonb_build_object(
  'quiet_start', to_char(now() AT TIME ZONE 'UTC' - interval '1 hour', 'HH24:MI'),
  'quiet_end',   to_char(now() AT TIME ZONE 'UTC' + interval '1 hour', 'HH24:MI'))
WHERE id = 'ac000000-0000-4000-8000-000000000004';

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 00:00+00') = ARRAY['Pat@2026-10-08'],
    format('TEST 3a FAILED: at midnight only Pat should hear, told %s',
           public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 00:00+00'));
END $$;

UPDATE public.profiles SET notification_prefs = '{}'::jsonb
WHERE id = 'ac000000-0000-4000-8000-000000000004';
-- Pat heard at midnight.
UPDATE public.habit_shares SET last_miss_alert_date = '2026-10-08'
WHERE habit_id = 'ad000000-0000-4000-8000-000000000001'
  AND shared_with = 'ac000000-0000-4000-8000-000000000003';

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 07:00+00') = ARRAY['Quinn@2026-10-08'],
    format('TEST 3a FAILED: Quinn should hear about Thursday once awake, and Pat not again, told %s',
           public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 07:00+00'));

  UPDATE public.habit_shares SET last_miss_alert_date = '2026-10-08'
  WHERE habit_id = 'ad000000-0000-4000-8000-000000000001'
    AND shared_with = 'ac000000-0000-4000-8000-000000000004';
  ASSERT public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 08:00+00') = '{}',
    'TEST 3b FAILED: Thursday was told again';
  RAISE NOTICE 'TEST 3 PASSED: a partner asleep at midnight hears about yesterday in the morning, once';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: one day at a time, the latest
-- ---------------------------------------------------------------------------
-- Twice was missed on Thursday and Friday, and Pat was told about neither.

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-000000000009', '2026-10-09 08:30+00') = ARRAY['Pat@2026-10-08'],
    'TEST 4a FAILED: before Friday''s window closed, Thursday should be told';
  ASSERT public._told('ad000000-0000-4000-8000-000000000009', '2026-10-09 10:00+00') = ARRAY['Pat@2026-10-09'],
    format('TEST 4a FAILED: with both days missed, only Friday should be told, told %s',
           public._told('ad000000-0000-4000-8000-000000000009', '2026-10-09 10:00+00'));

  UPDATE public.habit_shares SET last_miss_alert_date = '2026-10-09'
  WHERE habit_id = 'ad000000-0000-4000-8000-000000000009';
  ASSERT public._told('ad000000-0000-4000-8000-000000000009', '2026-10-09 11:00+00') = '{}',
    'TEST 4b FAILED: told about Friday, Pat was then told about Thursday';
  RAISE NOTICE 'TEST 4 PASSED: a partner hears about the latest missed day, and not the one before it after';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: a paused day is not told
-- ---------------------------------------------------------------------------
-- Rest was paused on Thursday and resumed on Friday.

INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('ad000000-0000-4000-8000-00000000000a', '2026-10-08', '2026-10-09');

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-00000000000a', '2026-10-09 08:30+00') = '{}',
    'TEST 5 FAILED: Thursday, paused, was told missed the morning after';
  ASSERT public._told('ad000000-0000-4000-8000-00000000000a', '2026-10-09 10:00+00') = ARRAY['Pat@2026-10-09'],
    'TEST 5 FAILED: Friday, back from the pause, should be told';
  RAISE NOTICE 'TEST 5 PASSED: a day that was paused is not told, even once the habit is back';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a window put in place after it closed is not told
-- ---------------------------------------------------------------------------
-- The trigger stamps a change with the real clock; each change here is moved
-- to the moment in the week it stands for.

INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at) VALUES
  ('ad000000-0000-4000-8000-000000000020', 'ac000000-0000-4000-8000-000000000001', 'New', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', '2026-10-08 15:00+00');
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at)
VALUES ('ad000000-0000-4000-8000-000000000020', 'ac000000-0000-4000-8000-000000000003', 'accepted',
        'ac000000-0000-4000-8000-000000000001', '2026-10-08 15:00+00');

UPDATE public.habits SET time_window = '{"start":"08:00","end":"09:00","days":{}}'
WHERE id = 'ad000000-0000-4000-8000-00000000000b';
UPDATE public.habits SET time_window = '{"start":"08:00","end":"09:00","days":{}}'
WHERE id = 'ad000000-0000-4000-8000-00000000000c';
UPDATE public.habits SET schedule = '{"days":[1,3,4,5]}'
WHERE id = 'ad000000-0000-4000-8000-00000000000e';
UPDATE public.habits SET timing_changed_at = '2026-10-08 15:00+00'
WHERE id IN ('ad000000-0000-4000-8000-00000000000b', 'ad000000-0000-4000-8000-00000000000c',
             'ad000000-0000-4000-8000-00000000000e');

UPDATE public.habits SET time_window = '{"start":"19:00","end":"20:00","days":{}}'
WHERE id = 'ad000000-0000-4000-8000-00000000000d';
UPDATE public.habits SET timing_changed_at = '2026-10-08 08:30+00'
WHERE id = 'ad000000-0000-4000-8000-00000000000d';

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-000000000020', '2026-10-08 16:00+00') = '{}',
    'TEST 6a FAILED: a habit created at 3 PM was told missed for its 8 AM window';
  ASSERT public._told('ad000000-0000-4000-8000-000000000020', '2026-10-09 10:00+00') = ARRAY['Pat@2026-10-09'],
    'TEST 6a FAILED: the day after it was created, New should be told as usual';
  RAISE NOTICE 'TEST 6a PASSED: a habit created after its window closed is not missed that day';

  ASSERT public._told('ad000000-0000-4000-8000-00000000000b', '2026-10-08 16:00+00') = '{}',
    'TEST 6b FAILED: a time added at 3 PM was told missed for that morning';
  ASSERT public._told('ad000000-0000-4000-8000-00000000000c', '2026-10-08 16:00+00') = '{}',
    'TEST 6b FAILED: a time moved earlier past the hour was told missed';
  ASSERT public._told('ad000000-0000-4000-8000-00000000000e', '2026-10-08 16:00+00') = '{}',
    'TEST 6b FAILED: put on Thursday at 3 PM, it was told missed for that morning';
  ASSERT public._told('ad000000-0000-4000-8000-00000000000b', '2026-10-09 10:00+00') = ARRAY['Pat@2026-10-09'],
    'TEST 6b FAILED: the day after the time was added, Added should be told as usual';
  RAISE NOTICE 'TEST 6b PASSED: a time added, moved earlier or a day added after the window closed is not missed that day';

  ASSERT public._told('ad000000-0000-4000-8000-00000000000d', '2026-10-08 10:00+00') = '{}',
    'TEST 6c FAILED: moved to the evening at 8:30, Later was told missed at 10';
  ASSERT public._told('ad000000-0000-4000-8000-00000000000d', '2026-10-08 21:00+00') = ARRAY['Pat@2026-10-08'],
    'TEST 6c FAILED: Later should be told once its new window closed undone';
  RAISE NOTICE 'TEST 6c PASSED: a time moved later is judged by the new window';
END $$;

-- Changed at 12:10 AM, after Late's window closed the night before.
UPDATE public.habits SET schedule = '{"days":[1,2,3,4,5,6]}'
WHERE id = 'ad000000-0000-4000-8000-000000000002';
UPDATE public.habits SET timing_changed_at = '2026-10-09 00:10+00'
WHERE id = 'ad000000-0000-4000-8000-000000000002';

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-000000000002', '2026-10-09 01:00+00') = '{}',
    'TEST 6d FAILED: changed after midnight, Eleven was still told about the night before';
  RAISE NOTICE 'TEST 6d PASSED: a change after a late window closed leaves it untold';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: a partner hears only about windows that closed since they became one
-- ---------------------------------------------------------------------------

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at, responded_at) VALUES
  -- Asked on the 1st, said yes on Thursday at 3 PM.
  ('ad000000-0000-4000-8000-00000000000f', 'ac000000-0000-4000-8000-000000000005', 'accepted',
   'ac000000-0000-4000-8000-000000000001', '2026-10-01 00:00+00', '2026-10-08 15:00+00'),
  -- Said yes at 11:45 PM, after Late's window closed.
  ('ad000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000005', 'accepted',
   'ac000000-0000-4000-8000-000000000001', '2026-10-01 00:00+00', '2026-10-08 23:45+00');

DO $$
BEGIN
  ASSERT public._told('ad000000-0000-4000-8000-00000000000f', '2026-10-08 16:00+00') = ARRAY['Pat@2026-10-08'],
    format('TEST 7a FAILED: Newt became a partner at 3 PM and heard about the morning, told %s',
           public._told('ad000000-0000-4000-8000-00000000000f', '2026-10-08 16:00+00'));
  ASSERT public._told('ad000000-0000-4000-8000-00000000000f', '2026-10-09 10:00+00') = ARRAY['Newt@2026-10-09', 'Pat@2026-10-09'],
    'TEST 7a FAILED: the next morning, Newt should hear like any partner';
  RAISE NOTICE 'TEST 7a PASSED: a new partner hears nothing about a window that closed before they said yes';

  UPDATE public.habit_shares SET last_miss_alert_date = NULL
  WHERE habit_id = 'ad000000-0000-4000-8000-000000000001';
  ASSERT public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 00:00+00') = ARRAY['Pat@2026-10-08', 'Quinn@2026-10-08'],
    format('TEST 7b FAILED: Newt said yes after Late closed and heard about it, told %s',
           public._told('ad000000-0000-4000-8000-000000000001', '2026-10-09 00:00+00'));
  RAISE NOTICE 'TEST 7b PASSED: nor about a late window that closed before they said yes';
END $$;

-- The inbox, on Thursday at 4 PM, takes the same two rules as the push.
CREATE FUNCTION public._inbox(p_partner UUID) RETURNS TEXT[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(title ORDER BY title), '{}')
  FROM public.get_inbox_missed_habits(
    p_partner, '2026-10-08', 4, '2026-10-08 00:00+00', '2026-10-09 00:00+00', '16:00')
  WHERE habit_id IN ('ad000000-0000-4000-8000-00000000000b', 'ad000000-0000-4000-8000-00000000000f',
                     'ad000000-0000-4000-8000-000000000020')
$fn$;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ac000000-0000-4000-8000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._inbox('ac000000-0000-4000-8000-000000000003') = ARRAY['Morning'],
    format('TEST 7c FAILED: Pat''s inbox should list Morning, and not New or Added, set after 9 AM: %s',
           public._inbox('ac000000-0000-4000-8000-000000000003'));
END $$;
SET LOCAL request.jwt.claims TO '{"sub":"ac000000-0000-4000-8000-000000000005","role":"authenticated"}';
DO $$
BEGIN
  ASSERT public._inbox('ac000000-0000-4000-8000-000000000005') = '{}',
    format('TEST 7c FAILED: Newt''s inbox listed a window that closed before Newt said yes: %s',
           public._inbox('ac000000-0000-4000-8000-000000000005'));
  RAISE NOTICE 'TEST 7c PASSED: the inbox lists neither a window set after it closed nor one closed before the partner';
END $$;
RESET role;

-- ---------------------------------------------------------------------------
-- Test 8: what counts as a change to a habit's timing
-- ---------------------------------------------------------------------------
-- now() is when this transaction began, so a change stamps exactly that.

UPDATE public.habits SET timing_changed_at = NULL, last_reminder_date = '2026-10-08'
WHERE id = 'ad000000-0000-4000-8000-000000000013';

DO $$
DECLARE
  h RECORD;
BEGIN
  -- A rename from the edit sheet sends everything as it was: the window with
  -- an empty map of days, and the days in another order.
  UPDATE public.habits
  SET title = 'Moved along', time_window = '{"start":"08:00","end":"09:00","days":{}}',
      schedule = '{"days":[6,5,4,3,2,1,0]}', frequency = 'daily'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  SELECT timing_changed_at, last_reminder_date INTO h FROM public.habits
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  ASSERT h.timing_changed_at IS NULL AND h.last_reminder_date = '2026-10-08',
    format('TEST 8a FAILED: a save that changed no timing counted as one: %s, %s', h.timing_changed_at, h.last_reminder_date);
  RAISE NOTICE 'TEST 8a PASSED: a save that leaves the timing as it was is no change';

  UPDATE public.habits SET time_window = '{"start":"18:00","end":"19:00","days":{}}'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  SELECT timing_changed_at, last_reminder_date INTO h FROM public.habits
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  ASSERT h.timing_changed_at = now() AND h.last_reminder_date IS NULL,
    format('TEST 8b FAILED: a new window should stamp the change and re-arm the reminder: %s, %s', h.timing_changed_at, h.last_reminder_date);

  UPDATE public.habits SET timing_changed_at = NULL WHERE id = 'ad000000-0000-4000-8000-000000000013';
  UPDATE public.habits SET schedule = '{"days":[1,2,3,4,5]}', frequency = 'weeksdays'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  ASSERT (SELECT timing_changed_at FROM public.habits WHERE id = 'ad000000-0000-4000-8000-000000000013') = now(),
    'TEST 8b FAILED: new days should stamp a change';

  UPDATE public.habits SET timing_changed_at = NULL WHERE id = 'ad000000-0000-4000-8000-000000000013';
  UPDATE public.habits SET time_window = NULL WHERE id = 'ad000000-0000-4000-8000-000000000013';
  ASSERT (SELECT timing_changed_at FROM public.habits WHERE id = 'ad000000-0000-4000-8000-000000000013') = now(),
    'TEST 8b FAILED: dropping the time should stamp a change';
  RAISE NOTICE 'TEST 8b PASSED: a new window, new days or no time at all is a change, and re-arms the reminder';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9: reminders
-- ---------------------------------------------------------------------------

-- Moved, back on 8 to 9, was reminded at 8 on Thursday; at 10 it is moved to
-- 6 PM. The trigger re-arms it; the moment of the change doesn't matter.
UPDATE public.habits SET time_window = '{"start":"08:00","end":"09:00"}', schedule = '{"days":[0,1,2,3,4,5,6]}',
  frequency = 'daily'
WHERE id = 'ad000000-0000-4000-8000-000000000013';
UPDATE public.habits SET last_reminder_date = '2026-10-08'
WHERE id = 'ad000000-0000-4000-8000-000000000013';

DO $$
BEGIN
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000013', '2026-10-08 10:00+00', '2026-10-08 23:45+00') = '{}',
    'TEST 9a SETUP FAILED: reminded twice in a day';
  UPDATE public.habits SET time_window = '{"start":"18:00","end":"19:00","days":{}}'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000013', '2026-10-08 10:00+00', '2026-10-08 23:45+00') = ARRAY['Thu 18:00'],
    format('TEST 9a FAILED: moved to 6 PM after the morning''s reminder, reminded %s',
           public._reminded('ad000000-0000-4000-8000-000000000013', '2026-10-08 10:00+00', '2026-10-08 23:45+00'));
  RAISE NOTICE 'TEST 9a PASSED: a time moved later after the day''s reminder is reminded again';

  -- Moved at 10 to 9 AM, already past: not reminded again that day.
  UPDATE public.habits SET last_reminder_date = '2026-10-08' WHERE id = 'ad000000-0000-4000-8000-000000000013';
  UPDATE public.habits SET time_window = '{"start":"09:00","end":"09:30","days":{}}'
  WHERE id = 'ad000000-0000-4000-8000-000000000013';
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000013', '2026-10-08 10:00+00', '2026-10-08 23:45+00') = '{}',
    'TEST 9b FAILED: a time moved to one already past was reminded';
  RAISE NOTICE 'TEST 9b PASSED: a time moved to one already past is not reminded that day';

  -- Reminders go out on the quarter hour: 9:07 is reminded at 9.
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000014', '2026-10-08 00:00+00', '2026-10-08 23:45+00') = ARRAY['Thu 09:00'],
    format('TEST 9c FAILED: 9:07 was reminded %s',
           public._reminded('ad000000-0000-4000-8000-000000000014', '2026-10-08 00:00+00', '2026-10-08 23:45+00'));
  RAISE NOTICE 'TEST 9c PASSED: a time off the quarter hour is reminded at the quarter before it';
END $$;

-- Weekly. Read has no time; Call is 8 to 9 and done on Tuesday.
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('ad000000-0000-4000-8000-000000000012', 'ac000000-0000-4000-8000-000000000001', 'quick', '2026-10-06 12:00+00');

DO $$
DECLARE
  v_told INT;
BEGIN
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000011', '2026-10-04 00:00+00', '2026-10-10 23:45+00') = '{}',
    'TEST 9d FAILED: a weekly habit with no time was reminded';
  SELECT count(*) INTO v_told
  FROM generate_series('2026-10-04 01:00+00'::timestamptz, '2026-10-11 01:00+00', interval '1 hour') t
  WHERE public._told('ad000000-0000-4000-8000-000000000011', t) <> '{}';
  ASSERT v_told = 0, 'TEST 9d FAILED: a weekly habit with no time was told missed';
  RAISE NOTICE 'TEST 9d PASSED: a weekly habit with no time is never reminded or told missed';

  -- Asked of the days either side: a run on Tuesday morning here would
  -- already see that afternoon's check-in.
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000012', '2026-10-04 00:00+00', '2026-10-05 23:45+00') = ARRAY['Sun 08:00', 'Mon 08:00'],
    format('TEST 9e FAILED: Call should be reminded each morning before it was done, reminded %s',
           public._reminded('ad000000-0000-4000-8000-000000000012', '2026-10-04 00:00+00', '2026-10-05 23:45+00'));
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000012', '2026-10-07 00:00+00', '2026-10-10 23:45+00') = '{}',
    'TEST 9e FAILED: Call was done on Tuesday, and reminded again later that week';
  ASSERT public._told('ad000000-0000-4000-8000-000000000012', '2026-10-10 10:00+00') = '{}',
    'TEST 9e FAILED: Call was done on Tuesday, and told missed on Saturday';
  RAISE NOTICE 'TEST 9e PASSED: a weekly habit with a time is reminded each day until done that week';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10: dropping a habit's time
-- ---------------------------------------------------------------------------
-- Dropped was told missed on Thursday at 10, and its time is dropped at noon.

UPDATE public.habit_shares SET last_miss_alert_date = '2026-10-08'
WHERE habit_id = 'ad000000-0000-4000-8000-000000000010';

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ac000000-0000-4000-8000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM public.get_inbox_missed_habits(
      'ac000000-0000-4000-8000-000000000003', '2026-10-08', 4,
      '2026-10-08 00:00+00', '2026-10-09 00:00+00', '12:00')
    WHERE habit_id = 'ad000000-0000-4000-8000-000000000010'),
    'TEST 10 SETUP FAILED: Dropped should be in Pat''s inbox before its time is dropped';
END $$;
RESET role;

UPDATE public.habits SET time_window = NULL WHERE id = 'ad000000-0000-4000-8000-000000000010';
UPDATE public.habits SET timing_changed_at = '2026-10-08 12:00+00' WHERE id = 'ad000000-0000-4000-8000-000000000010';

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"ac000000-0000-4000-8000-000000000003","role":"authenticated"}';
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.get_inbox_missed_habits(
      'ac000000-0000-4000-8000-000000000003', '2026-10-08', 4,
      '2026-10-08 00:00+00', '2026-10-09 00:00+00', '13:00')
    WHERE habit_id = 'ad000000-0000-4000-8000-000000000010'),
    'TEST 10a FAILED: with no time, Dropped is still in Pat''s inbox';
END $$;
RESET role;

DO $$
DECLARE
  v_runs INT;
BEGIN
  SELECT count(*) INTO v_runs
  FROM generate_series('2026-10-08 13:00+00'::timestamptz, '2026-10-11 00:00+00', interval '1 hour') t
  WHERE public._told('ad000000-0000-4000-8000-000000000010', t) <> '{}';
  ASSERT v_runs = 0, 'TEST 10a FAILED: with no time, Dropped was told missed';
  ASSERT public._reminded('ad000000-0000-4000-8000-000000000010', '2026-10-09 00:00+00', '2026-10-10 23:45+00') = '{}',
    'TEST 10a FAILED: with no time, Dropped was reminded';
  ASSERT (SELECT last_miss_alert_date FROM public.habit_shares
          WHERE habit_id = 'ad000000-0000-4000-8000-000000000010') = '2026-10-08',
    'TEST 10a FAILED: dropping the time touched what Pat was told';
  RAISE NOTICE 'TEST 10a PASSED: with its time dropped, a habit is not reminded, told missed or listed in the inbox';
END $$;

-- The streak: done on the three days before today, then its time dropped.
INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at) VALUES
  ('ad000000-0000-4000-8000-000000000021', 'ac000000-0000-4000-8000-000000000001', 'Steady', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', now() - interval '30 days');
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT 'ad000000-0000-4000-8000-000000000021', 'ac000000-0000-4000-8000-000000000001', 'quick', public._days_ago(n)
FROM unnest(ARRAY[3, 2, 1]) AS n
ORDER BY n DESC;
UPDATE public.habits SET time_window = NULL WHERE id = 'ad000000-0000-4000-8000-000000000021';
SELECT public.reset_stale_streaks();

DO $$
BEGIN
  ASSERT (SELECT streak_current FROM public.habits WHERE id = 'ad000000-0000-4000-8000-000000000021') = 3,
    format('TEST 10b FAILED: dropping the time moved the streak to %s',
           (SELECT streak_current FROM public.habits WHERE id = 'ad000000-0000-4000-8000-000000000021'));
  RAISE NOTICE 'TEST 10b PASSED: dropping the time leaves the streak alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11: the partner's badge takes the same two rules
-- ---------------------------------------------------------------------------
-- It reads the real clock. Badge's window today is midnight to a minute past,
-- closed already — except in the first two minutes of the day.

INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, created_at) VALUES
  ('ad000000-0000-4000-8000-000000000022', 'ac000000-0000-4000-8000-000000000001', 'Badge', 'daily',
   '{"days":[0,1,2,3,4,5,6]}', '{"start":"00:00","end":"00:01"}', now() - interval '2 days');
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at)
VALUES ('ad000000-0000-4000-8000-000000000022', 'ac000000-0000-4000-8000-000000000006', 'accepted',
        'ac000000-0000-4000-8000-000000000001', now() - interval '2 days');

SET LOCAL request.jwt.claims TO '{"sub":"ac000000-0000-4000-8000-000000000006","role":"authenticated"}';

DO $$
BEGIN
  IF to_char(now() AT TIME ZONE 'UTC', 'HH24:MI') < '00:02' THEN
    RAISE NOTICE 'TEST 11 SKIPPED: too close to midnight UTC for a closed window';
    RETURN;
  END IF;

  ASSERT public.get_missed_habit_count('UTC') = 1,
    format('TEST 11 SETUP FAILED: expected Badge counted, got %s', public.get_missed_habit_count('UTC'));

  UPDATE public.habits SET timing_changed_at = now()
  WHERE id = 'ad000000-0000-4000-8000-000000000022';
  ASSERT public.get_missed_habit_count('UTC') = 0,
    'TEST 11 FAILED: a window set after it closed was counted on the badge';

  UPDATE public.habits SET timing_changed_at = NULL
  WHERE id = 'ad000000-0000-4000-8000-000000000022';
  UPDATE public.habit_shares SET responded_at = now()
  WHERE habit_id = 'ad000000-0000-4000-8000-000000000022';
  ASSERT public.get_missed_habit_count('UTC') = 0,
    'TEST 11 FAILED: a window that closed before Bea was a partner was counted on her badge';

  RAISE NOTICE 'TEST 11 PASSED: the badge counts neither a window set after it closed nor one closed before the partner';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL MISSED ALERT TIMING TESTS PASSED ==='; END $$;

ROLLBACK;
