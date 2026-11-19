-- =============================================================================
-- Check-in media access (migration 059)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/checkin-media-access.test.sql
--
-- Who can read a file in the completions bucket, asked of storage.objects the
-- way Storage asks it: the owner always; a partner or group member only
-- while a live check-in shows the file; nobody else, signed in or not.
-- Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- No push stub needed: notify_completion only sends when a partner has a
-- subscription, and nobody here has one.

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner     owns habit H and checks in on it
-- partner   accepted partner on H
-- member    in a group H is shared with
-- stranger  no relationship to anyone

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-owner@test.com',    crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-partner@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-member@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET timezone = 'UTC', notification_prefs = '{}'::jsonb
WHERE id IN ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002',
             'd3000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000004');

INSERT INTO public.habits (id, user_id, title) VALUES
  ('d5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Pray');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by) VALUES
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'accepted', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.groups (id, name, created_by)
VALUES ('d6000000-0000-4000-8000-000000000001', 'Media Circle', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d6000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000003', 'member');

INSERT INTO public.group_habit_shares (group_id, habit_id, shared_by) VALUES
  ('d6000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');

-- The files, as Storage records them. live.webp has a check-in; gone.webp's
-- check-in is deleted below; orphan.webp never had one; planted.webp sits
-- under the stranger's folder but names H.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('completions', 'd1000000-0000-4000-8000-000000000001/d5000000-0000-4000-8000-000000000001/live.webp',   'd1000000-0000-4000-8000-000000000001'),
  ('completions', 'd1000000-0000-4000-8000-000000000001/d5000000-0000-4000-8000-000000000001/gone.webp',   'd1000000-0000-4000-8000-000000000001'),
  ('completions', 'd1000000-0000-4000-8000-000000000001/d5000000-0000-4000-8000-000000000001/orphan.webp', 'd1000000-0000-4000-8000-000000000001'),
  ('completions', 'd1000000-0000-4000-8000-000000000001/private/secret.webp',                              'd1000000-0000-4000-8000-000000000001'),
  ('completions', 'd4000000-0000-4000-8000-000000000004/d5000000-0000-4000-8000-000000000001/planted.webp', 'd4000000-0000-4000-8000-000000000004');

INSERT INTO public.completions (id, habit_id, user_id, completion_type, evidence_url, completed_date) VALUES
  ('d7000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
   'photo', 'd1000000-0000-4000-8000-000000000001/d5000000-0000-4000-8000-000000000001/live.webp', current_date),
  ('d7000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
   'photo', 'd1000000-0000-4000-8000-000000000001/d5000000-0000-4000-8000-000000000001/gone.webp', current_date - 1);

DELETE FROM public.completions WHERE id = 'd7000000-0000-4000-8000-000000000002';

CREATE FUNCTION pg_temp.visible(p_file TEXT) RETURNS BOOLEAN
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'completions' AND name LIKE '%/' || p_file
  );
$$;

-- ---------------------------------------------------------------------------
-- Test 1: the owner reads everything in their folder
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$ BEGIN
  ASSERT pg_temp.visible('live.webp')   AND pg_temp.visible('gone.webp')
     AND pg_temp.visible('orphan.webp') AND pg_temp.visible('secret.webp'),
    'TEST 1 FAILED: the owner cannot read their own files';
  ASSERT NOT pg_temp.visible('planted.webp'),
    'TEST 1 FAILED: the owner can read a file in someone else''s folder';
  RAISE NOTICE 'TEST 1 PASSED: the owner reads their own folder, and only that';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a partner reads a live check-in's file and nothing else
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"d2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$ BEGIN
  ASSERT pg_temp.visible('live.webp'),
    'TEST 2a FAILED: a partner cannot read a live check-in''s photo';
  ASSERT NOT pg_temp.visible('gone.webp'),
    'TEST 2b FAILED: a partner can still read a deleted check-in''s photo';
  ASSERT NOT pg_temp.visible('orphan.webp'),
    'TEST 2c FAILED: a partner can read a file in the habit''s folder no check-in shows';
  ASSERT NOT pg_temp.visible('planted.webp'),
    'TEST 2d FAILED: a partner can read a file someone else put under the habit''s id';
  ASSERT NOT pg_temp.visible('secret.webp'),
    'TEST 2e FAILED: a partner can read private media';
  RAISE NOTICE 'TEST 2 PASSED: a partner reads the live check-in''s file only';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a group member, the same
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"d3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$ BEGIN
  ASSERT pg_temp.visible('live.webp'),
    'TEST 3a FAILED: a group member cannot read a live check-in''s photo';
  ASSERT NOT pg_temp.visible('gone.webp') AND NOT pg_temp.visible('orphan.webp')
     AND NOT pg_temp.visible('secret.webp'),
    'TEST 3b FAILED: a group member can read a file no live check-in shows';
  RAISE NOTICE 'TEST 3 PASSED: a group member reads the live check-in''s file only';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a stranger and a signed-out visitor read nothing
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"d4000000-0000-4000-8000-000000000004","role":"authenticated"}';

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM storage.objects
          WHERE bucket_id = 'completions'
            AND name NOT LIKE 'd4000000-0000-4000-8000-000000000004/%') = 0,
    'TEST 4a FAILED: a stranger can read someone else''s check-in media';
  RAISE NOTICE 'TEST 4a PASSED: a stranger reads nothing of anyone else''s';
END $$;

SET LOCAL role TO anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM storage.objects WHERE bucket_id = 'completions') = 0,
    'TEST 4b FAILED: a signed-out visitor can read check-in media';
  RAISE NOTICE 'TEST 4b PASSED: a signed-out visitor reads nothing';
END $$;

ROLLBACK;
