-- =============================================================================
-- Asking once before a check-in first reaches somebody (migration 040)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/checkin-sharing.test.sql
--
-- The app holds the first check-in that would reach a real person until the
-- user confirms. That only works if get_checkin_audience names exactly who a
-- habit's check-in goes to — a partner who has not accepted, or a group with
-- nobody else in it, would put the question in front of someone for nothing,
-- and a missed group would let the first check-in go out unasked.
--
-- pg_net is not installed on a local stack, so `net` is stubbed to record the
-- push the notify triggers would send. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner      the one checking in
-- pat        accepted partner on "Partnered"
-- quinn      invited to "Partnered", has not answered
-- rae        declined "Partnered"
-- sam        in "Circle" and "Challengers" with owner
-- other      someone else entirely, with a partner of their own
--
-- owner's habits:
--   Alone        nobody
--   Partnered    pat accepted, quinn pending, rae declined
--   Grouped      shared with Circle (owner + sam)
--   Solo group   shared with Just me (owner only)
--   Challenge    in Challengers' active challenge (owner + sam)
--   Old challenge in Challengers' finished challenge

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ck-owner@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('72000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ck-pat@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('73000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ck-quinn@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('74000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ck-rae@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('75000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ck-sam@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('76000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ck-other@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Owner', username = 'ck_owner' WHERE id = '71000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET display_name = 'Pat',   username = 'ck_pat'   WHERE id = '72000000-0000-4000-8000-000000000002';
UPDATE public.profiles SET display_name = 'Quinn', username = 'ck_quinn' WHERE id = '73000000-0000-4000-8000-000000000003';
UPDATE public.profiles SET display_name = 'Rae',   username = 'ck_rae'   WHERE id = '74000000-0000-4000-8000-000000000004';
UPDATE public.profiles SET display_name = 'Sam',   username = 'ck_sam'   WHERE id = '75000000-0000-4000-8000-000000000005';
UPDATE public.profiles SET display_name = 'Other', username = 'ck_other' WHERE id = '76000000-0000-4000-8000-000000000006';

INSERT INTO public.habits (id, user_id, title) VALUES
  ('77000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Alone'),
  ('77000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'Partnered'),
  ('77000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', 'Grouped'),
  ('77000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000001', 'Solo group'),
  ('77000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000001', 'Challenge'),
  ('77000000-0000-4000-8000-000000000006', '71000000-0000-4000-8000-000000000001', 'Old challenge'),
  ('77000000-0000-4000-8000-000000000007', '76000000-0000-4000-8000-000000000006', 'Not yours');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by) VALUES
  ('77000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'accepted', '71000000-0000-4000-8000-000000000001'),
  ('77000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000003', 'pending',  '71000000-0000-4000-8000-000000000001'),
  ('77000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000004', 'declined', '71000000-0000-4000-8000-000000000001'),
  ('77000000-0000-4000-8000-000000000007', '72000000-0000-4000-8000-000000000002', 'accepted', '76000000-0000-4000-8000-000000000006');

INSERT INTO public.groups (id, name, created_by) VALUES
  ('78000000-0000-4000-8000-000000000001', 'Circle',      '71000000-0000-4000-8000-000000000001'),
  ('78000000-0000-4000-8000-000000000002', 'Just me',     '71000000-0000-4000-8000-000000000001'),
  ('78000000-0000-4000-8000-000000000003', 'Challengers', '71000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('78000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'admin'),
  ('78000000-0000-4000-8000-000000000001', '75000000-0000-4000-8000-000000000005', 'member'),
  ('78000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', 'admin'),
  ('78000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', 'admin'),
  ('78000000-0000-4000-8000-000000000003', '75000000-0000-4000-8000-000000000005', 'member');

INSERT INTO public.group_habit_shares (group_id, habit_id, shared_by) VALUES
  ('78000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001'),
  ('78000000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000001');

INSERT INTO public.group_challenges (id, group_id, title, created_by, is_active) VALUES
  ('79000000-0000-4000-8000-000000000001', '78000000-0000-4000-8000-000000000003', 'Live',     '71000000-0000-4000-8000-000000000001', true),
  ('79000000-0000-4000-8000-000000000002', '78000000-0000-4000-8000-000000000003', 'Finished', '71000000-0000-4000-8000-000000000001', false);

INSERT INTO public.group_challenge_participants (challenge_id, user_id, habit_id) VALUES
  ('79000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000005'),
  ('79000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000006');

-- Whatever the migration's backfill made of the fixtures above, the owner
-- starts out never having been asked.
UPDATE public.profiles SET checkin_sharing_confirmed_at = NULL
WHERE id = '71000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Test 1: the audience is exactly who a check-in reaches
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}';

CREATE TEMP TABLE _aud AS
SELECT a.*
FROM jsonb_to_recordset(public.get_checkin_audience()->'audience')
  AS a(habit_id UUID, kind TEXT, id UUID, name TEXT, avatar_url TEXT);

DO $$
BEGIN
  ASSERT (public.get_checkin_audience()->>'confirmed')::boolean = false,
    'TEST 1 FAILED: a new user should not start out confirmed';

  ASSERT NOT EXISTS (SELECT 1 FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000001'),
    'TEST 1a FAILED: a habit with nobody on it reaches somebody';

  ASSERT (SELECT array_agg(name) FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000002')
           = ARRAY['Pat'],
    'TEST 1b FAILED: only the accepted partner should be named — not the pending or declined one';
  ASSERT (SELECT kind FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000002') = 'partner',
    'TEST 1b FAILED: a partner should be marked as one';

  ASSERT (SELECT array_agg(name) FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000003')
           = ARRAY['Circle'],
    'TEST 1c FAILED: a habit shared with a group should reach the group';
  ASSERT (SELECT kind FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000003') = 'group',
    'TEST 1c FAILED: a group should be marked as one';

  ASSERT NOT EXISTS (SELECT 1 FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000004'),
    'TEST 1d FAILED: a group with only the owner in it reaches nobody';

  ASSERT (SELECT array_agg(name) FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000005')
           = ARRAY['Challengers'],
    'TEST 1e FAILED: a habit in an active challenge should reach its group';

  ASSERT NOT EXISTS (SELECT 1 FROM _aud WHERE habit_id = '77000000-0000-4000-8000-000000000006'),
    'TEST 1f FAILED: a finished challenge no longer shows check-ins to its group';

  ASSERT (SELECT count(*) FROM _aud) = 3,
    format('TEST 1g FAILED: expected 3 entries, got %s — someone else''s habit leaked in?',
           (SELECT count(*) FROM _aud));

  RAISE NOTICE 'TEST 1 PASSED: the audience is exactly who a check-in reaches';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: confirming ends the question, and keeps the first answer
-- ---------------------------------------------------------------------------

DO $$
DECLARE r JSONB;
BEGIN
  PERFORM public.confirm_checkin_sharing();
  r := public.get_checkin_audience();
  ASSERT (r->>'confirmed')::boolean = true, 'TEST 2 FAILED: confirming did not stick';
  ASSERT jsonb_array_length(r->'audience') = 0,
    'TEST 2 FAILED: once confirmed, no audience is needed';
  RAISE NOTICE 'TEST 2 PASSED: confirming ends the question';
END $$;

RESET role;
UPDATE public.profiles SET checkin_sharing_confirmed_at = '2020-01-01T00:00:00Z'
WHERE id = '71000000-0000-4000-8000-000000000001';

-- Another device confirming later, or an offline confirmation replayed.
SET LOCAL role TO authenticated;
SELECT public.confirm_checkin_sharing();
RESET role;

DO $$
BEGIN
  ASSERT (SELECT checkin_sharing_confirmed_at FROM public.profiles
          WHERE id = '71000000-0000-4000-8000-000000000001') = '2020-01-01T00:00:00Z',
    'TEST 2b FAILED: a second confirmation overwrote the first';
  RAISE NOTICE 'TEST 2b PASSED: a replayed confirmation is harmless';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: confirming touches only your own profile
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"76000000-0000-4000-8000-000000000006","role":"authenticated"}';
SELECT public.confirm_checkin_sharing();
-- Checked as the table owner: RLS would hide the other rows from "other",
-- and a count of rows you cannot see proves nothing.
RESET role;

DO $$
BEGIN
  ASSERT (SELECT checkin_sharing_confirmed_at IS NOT NULL FROM public.profiles
          WHERE id = '76000000-0000-4000-8000-000000000006'),
    'TEST 3 FAILED: confirming did not set the caller''s own answer';
  ASSERT (SELECT count(*) FROM public.profiles
          WHERE checkin_sharing_confirmed_at IS NOT NULL
            AND id IN ('72000000-0000-4000-8000-000000000002',
                       '73000000-0000-4000-8000-000000000003',
                       '74000000-0000-4000-8000-000000000004',
                       '75000000-0000-4000-8000-000000000005')) = 0,
    'TEST 3 FAILED: confirming reached someone else''s profile';
  RAISE NOTICE 'TEST 3 PASSED: confirming touches only your own profile';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: signed out, neither function answers
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO anon;

DO $$
BEGIN
  BEGIN
    PERFORM public.get_checkin_audience();
    RAISE EXCEPTION 'TEST 4 FAILED: anon read an audience';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.confirm_checkin_sharing();
    RAISE EXCEPTION 'TEST 4 FAILED: anon confirmed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'TEST 4 PASSED: signed out, neither function answers';
END $$;

RESET role;

-- ---------------------------------------------------------------------------
-- Test 5: the backfill spares only people whose check-ins already went out
-- ---------------------------------------------------------------------------
-- Each of these has one check-in, on a habit that reaches somebody now. What
-- differs is whether that somebody was there when it was made.
--
--   early   partner accepted before the check-in           -> spared
--   late    partner accepted after the check-in            -> asked
--   joined  group member there before the check-in         -> spared
--   newbie  group member joined after the check-in         -> asked
--   racer   challenge-mate there before the check-in       -> spared
--   solo    never shared at all                            -> asked

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
-- A username of their own: the default is cut from the id's first eight
-- characters, which these share.
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', replace(split_part(u.email, '@', 1), '-', '_')), now(), now()
FROM (VALUES
  ('7a000000-0000-4000-8000-000000000001', 'ck-early@test.com'),
  ('7a000000-0000-4000-8000-000000000002', 'ck-late@test.com'),
  ('7a000000-0000-4000-8000-000000000003', 'ck-joined@test.com'),
  ('7a000000-0000-4000-8000-000000000004', 'ck-newbie@test.com'),
  ('7a000000-0000-4000-8000-000000000005', 'ck-racer@test.com'),
  ('7a000000-0000-4000-8000-000000000006', 'ck-solo@test.com')
) AS u(id, email);

INSERT INTO public.habits (id, user_id, title)
SELECT ('7b' || substr(id::text, 3))::uuid, id, 'Backfill'
FROM auth.users WHERE email LIKE 'ck-%' AND id::text LIKE '7a%';

-- Partners: accepted a week ago for early, an hour ago for late.
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, responded_at) VALUES
  ('7b000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'accepted', '7a000000-0000-4000-8000-000000000001', now() - interval '7 days'),
  ('7b000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', 'accepted', '7a000000-0000-4000-8000-000000000002', now() - interval '1 hour');

-- Groups: sam joined a week ago for joined, an hour ago for newbie.
INSERT INTO public.groups (id, name, created_by) VALUES
  ('7c000000-0000-4000-8000-000000000003', 'Joined', '7a000000-0000-4000-8000-000000000003'),
  ('7c000000-0000-4000-8000-000000000004', 'Newbie', '7a000000-0000-4000-8000-000000000004'),
  ('7c000000-0000-4000-8000-000000000005', 'Racers', '7a000000-0000-4000-8000-000000000005');

INSERT INTO public.group_members (group_id, user_id, role, joined_at) VALUES
  ('7c000000-0000-4000-8000-000000000003', '7a000000-0000-4000-8000-000000000003', 'admin',  now() - interval '30 days'),
  ('7c000000-0000-4000-8000-000000000003', '75000000-0000-4000-8000-000000000005', 'member', now() - interval '7 days'),
  ('7c000000-0000-4000-8000-000000000004', '7a000000-0000-4000-8000-000000000004', 'admin',  now() - interval '30 days'),
  ('7c000000-0000-4000-8000-000000000004', '75000000-0000-4000-8000-000000000005', 'member', now() - interval '1 hour'),
  ('7c000000-0000-4000-8000-000000000005', '7a000000-0000-4000-8000-000000000005', 'admin',  now() - interval '30 days'),
  ('7c000000-0000-4000-8000-000000000005', '75000000-0000-4000-8000-000000000005', 'member', now() - interval '7 days');

INSERT INTO public.group_habit_shares (group_id, habit_id, shared_by, created_at) VALUES
  ('7c000000-0000-4000-8000-000000000003', '7b000000-0000-4000-8000-000000000003', '7a000000-0000-4000-8000-000000000003', now() - interval '30 days'),
  ('7c000000-0000-4000-8000-000000000004', '7b000000-0000-4000-8000-000000000004', '7a000000-0000-4000-8000-000000000004', now() - interval '30 days');

INSERT INTO public.group_challenges (id, group_id, title, created_by, is_active) VALUES
  ('7d000000-0000-4000-8000-000000000005', '7c000000-0000-4000-8000-000000000005', 'Race', '7a000000-0000-4000-8000-000000000005', true);

INSERT INTO public.group_challenge_participants (challenge_id, user_id, habit_id, joined_at) VALUES
  ('7d000000-0000-4000-8000-000000000005', '7a000000-0000-4000-8000-000000000005', '7b000000-0000-4000-8000-000000000005', now() - interval '30 days');

-- One check-in each, two days ago.
INSERT INTO public.completions (user_id, habit_id, completion_type, completed_at)
SELECT h.user_id, h.id, 'quick', now() - interval '2 days'
FROM public.habits h WHERE h.id::text LIKE '7b%';

UPDATE public.profiles SET checkin_sharing_confirmed_at = NULL WHERE id::text LIKE '7a%';

-- The migration itself, run again over these people.
\ir ../supabase/migrations/040_checkin_sharing_confirmation.sql

DO $$
DECLARE
  spared TEXT[];
BEGIN
  SELECT array_agg(u.email ORDER BY u.email) INTO spared
  FROM public.profiles p JOIN auth.users u ON u.id = p.id
  WHERE p.id::text LIKE '7a%' AND p.checkin_sharing_confirmed_at IS NOT NULL;

  ASSERT spared = ARRAY['ck-early@test.com', 'ck-joined@test.com', 'ck-racer@test.com'],
    format('TEST 5 FAILED: expected early, joined and racer to be spared, got %s', spared);
  RAISE NOTICE 'TEST 5 PASSED: the backfill spares only people whose check-ins already went out';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL CHECK-IN SHARING TESTS PASSED ==='; END $$;

ROLLBACK;
