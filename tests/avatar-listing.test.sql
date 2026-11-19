-- =============================================================================
-- Avatar listing (migration 060)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/avatar-listing.test.sql
--
-- Avatars are served by their public URL, which RLS never sees. What RLS
-- does govern is listing the bucket, and nobody may list anyone else's:
-- not a stranger, and not a signed-out visitor reading off every user id.
-- Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- owner   has a profile photo
-- admin   runs a group with a photo
-- member  in that group, not an admin

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'al-owner@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('e2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'al-admin@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('e3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'al-member@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.groups (id, name, created_by)
VALUES ('e6000000-0000-4000-8000-000000000001', 'Photo Circle', 'e2000000-0000-4000-8000-000000000002');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'admin'),
  ('e6000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000003', 'member');

INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('avatars',       'e1000000-0000-4000-8000-000000000001/0b6e7c1a-photo.webp', 'e1000000-0000-4000-8000-000000000001'),
  ('group-avatars', 'e6000000-0000-4000-8000-000000000001/5d1f2e3b-photo.webp', 'e2000000-0000-4000-8000-000000000002'),
  -- Not a uuid folder: must be refused quietly, not break the listing.
  ('group-avatars', 'not-a-group/stray.webp',                                   'e2000000-0000-4000-8000-000000000002');

CREATE FUNCTION pg_temp.listed(p_bucket TEXT) RETURNS BIGINT
LANGUAGE sql AS $$
  SELECT count(*) FROM storage.objects WHERE bucket_id = p_bucket;
$$;

-- ---------------------------------------------------------------------------
-- Test 1: a signed-out visitor lists nothing
-- ---------------------------------------------------------------------------

SET LOCAL role TO anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

DO $$ BEGIN
  ASSERT pg_temp.listed('avatars') = 0,
    'TEST 1 FAILED: a signed-out visitor can list profile photos';
  ASSERT pg_temp.listed('group-avatars') = 0,
    'TEST 1 FAILED: a signed-out visitor can list group photos';
  RAISE NOTICE 'TEST 1 PASSED: a signed-out visitor lists nothing';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the owner lists their own folder, and no one else's
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$ BEGIN
  ASSERT pg_temp.listed('avatars') = 1,
    'TEST 2 FAILED: the owner cannot list their own photo';
  ASSERT pg_temp.listed('group-avatars') = 0,
    'TEST 2 FAILED: a non-member can list a group''s photos';
  RAISE NOTICE 'TEST 2 PASSED: the owner lists their own folder only';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a group admin lists the group's folder; a member does not
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"e2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$ BEGIN
  ASSERT pg_temp.listed('group-avatars') = 1,
    'TEST 3a FAILED: the admin cannot list the group''s photo (or the stray one leaked)';
  ASSERT pg_temp.listed('avatars') = 0,
    'TEST 3a FAILED: the admin can list someone else''s profile photo';
  RAISE NOTICE 'TEST 3a PASSED: the admin lists the group''s folder';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"e3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$ BEGIN
  ASSERT pg_temp.listed('group-avatars') = 0,
    'TEST 3b FAILED: a plain member can list the group''s photos';
  RAISE NOTICE 'TEST 3b PASSED: a member does not';
END $$;

ROLLBACK;
