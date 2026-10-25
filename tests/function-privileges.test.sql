-- =============================================================================
-- Internal helpers stay internal (migration 043)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/function-privileges.test.sql
--
-- habit_partner_ids, habit_group_ids, are_friends and is_accepted_partner
-- answer questions about other people. Supabase's default grants had them
-- callable over /rpc by anyone, signed in or not. This checks they no longer
-- are, and that everything built on them — the shared-habit policies, the
-- capture picker, profiles — still works.
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
-- owner     has "Walk", every day, partnered with partner and shared with Crew
-- partner   owner's friend, accepted partner on Walk, in Crew
-- stranger  no relationship to anyone

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fp-owner@test.com',    crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"fp_owner"}'::jsonb,    now(), now()),
  ('92000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fp-partner@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"fp_partner"}'::jsonb,  now(), now()),
  ('93000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fp-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"fp_stranger"}'::jsonb, now(), now());

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'accepted');

INSERT INTO public.habits (id, user_id, title, schedule) VALUES
  ('97000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Walk',
   '{"days": [0, 1, 2, 3, 4, 5, 6]}');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by) VALUES
  ('97000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'accepted', '91000000-0000-4000-8000-000000000001');

INSERT INTO public.groups (id, name, created_by) VALUES
  ('98000000-0000-4000-8000-000000000001', 'Crew', '91000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('98000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'admin'),
  ('98000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002', 'member');

INSERT INTO public.group_habit_shares (group_id, habit_id, shared_by) VALUES
  ('98000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001');

-- Yesterday's walk, so today's is still open.
INSERT INTO public.completions (user_id, habit_id, completion_type, completed_at) VALUES
  ('91000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'quick', now() - interval '1 day');

-- ---------------------------------------------------------------------------
-- Test 1: signed out, none of them answer
-- ---------------------------------------------------------------------------

SET LOCAL role TO anon;

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT public.habit_partner_ids('97000000-0000-4000-8000-000000000001')$q$,
    $q$SELECT public.habit_group_ids('97000000-0000-4000-8000-000000000001')$q$,
    $q$SELECT public.are_friends('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002')$q$,
    $q$SELECT public.is_accepted_partner('97000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 1 FAILED: anon could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'TEST 1 PASSED: signed out, none of them answer';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: signed in, a stranger can't ask about other people
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"93000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT public.habit_partner_ids('97000000-0000-4000-8000-000000000001')$q$,
    $q$SELECT public.habit_group_ids('97000000-0000-4000-8000-000000000001')$q$,
    $q$SELECT public.are_friends('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 2 FAILED: a signed-in user could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- Still theirs to call: the shared-habit policies run it as the reader.
  ASSERT NOT public.is_accepted_partner('97000000-0000-4000-8000-000000000001'),
    'TEST 2 FAILED: is_accepted_partner should answer for the caller';

  -- And a stranger still reads none of it.
  ASSERT (SELECT count(*) FROM public.habits WHERE id = '97000000-0000-4000-8000-000000000001') = 0,
    'TEST 2 FAILED: a stranger saw the habit';
  ASSERT (SELECT count(*) FROM public.completions WHERE habit_id = '97000000-0000-4000-8000-000000000001') = 0,
    'TEST 2 FAILED: a stranger saw a check-in';
  RAISE NOTICE 'TEST 2 PASSED: signed in, a stranger can''t ask about other people';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: everything built on them still works
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"92000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  -- The shared-habit policies, through is_accepted_partner.
  ASSERT (SELECT count(*) FROM public.habits WHERE id = '97000000-0000-4000-8000-000000000001') = 1,
    'TEST 3a FAILED: the partner lost sight of the habit';
  ASSERT (SELECT count(*) FROM public.completions WHERE habit_id = '97000000-0000-4000-8000-000000000001') = 1,
    'TEST 3a FAILED: the partner lost sight of its check-in';

  -- A friend's profile habits, through are_friends.
  PERFORM * FROM public.get_profile_habits('91000000-0000-4000-8000-000000000001');
  RAISE NOTICE 'TEST 3a PASSED: shared habits and profile habits still read';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  r RECORD;
BEGIN
  -- The capture picker, through habit_partner_ids and habit_group_ids.
  SELECT * INTO r FROM public.get_habits_due_today('UTC')
  WHERE id = '97000000-0000-4000-8000-000000000001';
  ASSERT r.partner_ids = ARRAY['92000000-0000-4000-8000-000000000002']::uuid[],
    format('TEST 3b FAILED: picker partner_ids were %s', r.partner_ids);
  ASSERT r.group_ids = ARRAY['98000000-0000-4000-8000-000000000001']::uuid[],
    format('TEST 3b FAILED: picker group_ids were %s', r.group_ids);

  -- The first-check-in question, through habit_group_ids.
  ASSERT jsonb_array_length(public.get_checkin_audience()->'audience') = 2,
    'TEST 3b FAILED: get_checkin_audience lost the partner or the group';
  RAISE NOTICE 'TEST 3b PASSED: the picker and the sharing question still see who a habit reaches';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: signed out, reading habits and check-ins is still just empty
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO anon;
-- A signed-out request carries no user, so auth.uid() is null.
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.habits) = 0, 'TEST 4 FAILED: anon saw habits';
  ASSERT (SELECT count(*) FROM public.completions) = 0, 'TEST 4 FAILED: anon saw check-ins';
  RAISE NOTICE 'TEST 4 PASSED: signed out, reading habits and check-ins is still just empty';
END $$;

RESET role;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL FUNCTION PRIVILEGE TESTS PASSED ==='; END $$;

ROLLBACK;
