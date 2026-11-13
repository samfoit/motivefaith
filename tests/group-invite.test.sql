-- =============================================================================
-- Group invite links (migration 054)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/group-invite.test.sql
--
-- Someone opens /main/feed/join/<code>. The page looks the group up by its
-- code, shows its name and how many are in it, and "Join Group" adds them.
--
-- The lookup was declared STABLE while writing a row for its rate limit, so
-- Postgres refused every call and every link said "Invite not found". Nothing
-- ran it as a signed-in user until someone followed a link; this does.
--
-- Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner    made "Dawn Patrol", in it with member
-- member   in the group
-- invitee  has the link, has not joined
-- prober   tries codes one after another

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gi-owner@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gi-member@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gi-invitee@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gi-prober@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO public.groups (id, name, description, created_by, invite_code)
VALUES ('d6000000-0000-4000-8000-000000000001', 'Dawn Patrol', 'Up before the sun', 'd1000000-0000-4000-8000-000000000001', 'dawnpatrol42');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d6000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'member');

-- ---------------------------------------------------------------------------
-- Test 1: someone with the link finds the group, and how many are in it
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
DECLARE
  v_group RECORD;
  v_rows INT;
BEGIN
  SELECT count(*) INTO v_rows FROM public.get_group_by_invite_code('dawnpatrol42');
  ASSERT v_rows = 1, format('TEST 1 FAILED: a valid code found %s groups', v_rows);

  SELECT * INTO v_group FROM public.get_group_by_invite_code('dawnpatrol42');
  ASSERT v_group.id = 'd6000000-0000-4000-8000-000000000001'
     AND v_group.name = 'Dawn Patrol'
     AND v_group.description = 'Up before the sun',
         format('TEST 1 FAILED: found %s', row_to_json(v_group));

  -- They cannot count the members themselves: group_members is members-only.
  ASSERT (SELECT count(*) FROM public.group_members
          WHERE group_id = 'd6000000-0000-4000-8000-000000000001') = 0,
         'TEST 1 FAILED: fixture: an invitee should not be able to read the member list';
  ASSERT v_group.member_count = 2,
         format('TEST 1 FAILED: said %s members, there are 2', v_group.member_count);

  RAISE NOTICE 'TEST 1 PASSED: a valid code finds its group and its member count';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a code that isn't one finds nothing, quietly
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.get_group_by_invite_code('no-such-code')) = 0,
         'TEST 2 FAILED: an unknown code found a group';
  ASSERT (SELECT count(*) FROM public.get_group_by_invite_code('')) = 0,
         'TEST 2 FAILED: an empty code found a group';
  RAISE NOTICE 'TEST 2 PASSED: an unknown code finds nothing';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: joining by the code adds them, once
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_joined RECORD;
BEGIN
  SELECT * INTO v_joined FROM public.join_group_by_invite_code('dawnpatrol42');
  ASSERT v_joined.group_id = 'd6000000-0000-4000-8000-000000000001' AND v_joined.group_name = 'Dawn Patrol',
         format('TEST 3 FAILED: joined %s', row_to_json(v_joined));

  -- A second tap is not an error and not a second membership.
  SELECT * INTO v_joined FROM public.join_group_by_invite_code('dawnpatrol42');
  ASSERT v_joined.group_id = 'd6000000-0000-4000-8000-000000000001', 'TEST 3 FAILED: joining twice lost the group';

  ASSERT (SELECT count(*) FROM public.join_group_by_invite_code('no-such-code')) = 0,
         'TEST 3 FAILED: joined a group that does not exist';

  -- Now a member, so the list is theirs to read.
  ASSERT (SELECT count(*) FROM public.group_members
          WHERE group_id = 'd6000000-0000-4000-8000-000000000001'
            AND user_id = 'd3000000-0000-4000-8000-000000000003' AND role = 'member') = 1,
         'TEST 3 FAILED: not in the group exactly once, as a member';
  ASSERT (SELECT member_count FROM public.get_group_by_invite_code('dawnpatrol42')) = 3,
         'TEST 3 FAILED: the count did not go up';

  RAISE NOTICE 'TEST 3 PASSED: joining adds a member once';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: signed out, the lookup answers nothing
-- ---------------------------------------------------------------------------

RESET role;
RESET request.jwt.claims;
SET LOCAL role TO anon;

DO $$
BEGIN
  BEGIN
    PERFORM * FROM public.get_group_by_invite_code('dawnpatrol42');
    RAISE EXCEPTION 'TEST 4 FAILED: a signed-out lookup answered';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'TEST 4 PASSED: signed out, no lookup';
END $$;

RESET role;

-- ---------------------------------------------------------------------------
-- Test 5: codes can't be tried one after another without limit
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d4000000-0000-4000-8000-000000000004","role":"authenticated"}';

DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 1..20 LOOP
    PERFORM * FROM public.get_group_by_invite_code('guess-' || i);
  END LOOP;

  BEGIN
    PERFORM * FROM public.get_group_by_invite_code('dawnpatrol42');
    RAISE EXCEPTION 'TEST 5 FAILED: a 21st lookup in a minute went through';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Rate limit exceeded%' THEN RAISE; END IF;
  END;

  -- The same limit covers joining, so guessing can't move there instead.
  BEGIN
    PERFORM * FROM public.join_group_by_invite_code('dawnpatrol42');
    RAISE EXCEPTION 'TEST 5 FAILED: joining got round the lookup limit';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Rate limit exceeded%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'TEST 5 PASSED: twenty lookups a minute, then refused';
END $$;

RESET role;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Test 6: no function that writes is declared read-only
-- ---------------------------------------------------------------------------
-- What broke the lookup, looked for everywhere: Postgres only refuses the
-- write when the function runs, so a function nobody has called yet can carry
-- this for months. A crude read of each body, enough to catch it early.

DO $$
DECLARE
  v_wrong TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_wrong
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.provolatile IN ('s', 'i')
    AND (p.prosrc ~* '\minsert\s+into\M'
      OR p.prosrc ~* '\mupdate\s+[a-z_.]+\s+set\M'
      OR p.prosrc ~* '\mdelete\s+from\M');

  ASSERT v_wrong IS NULL,
         format('TEST 6 FAILED: declared STABLE or IMMUTABLE but writes: %s', v_wrong);
  RAISE NOTICE 'TEST 6 PASSED: nothing that writes is declared read-only';
  RAISE NOTICE '=== ALL GROUP INVITE TESTS PASSED ===';
END $$;

ROLLBACK;
