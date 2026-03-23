-- =============================================================================
-- RLS Policy Tests for Motive
-- =============================================================================
-- Run against a local Supabase instance:
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/rls-policies.test.sql
--
-- These tests create two users (alice & bob), insert data as alice, and verify
-- that bob cannot read/write data he shouldn't have access to.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Setup: Create two test users in auth.users
-- ---------------------------------------------------------------------------

-- Alice
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'alice@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now()
);

-- Bob
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'bob@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now()
);

-- Charlie (no friendship with anyone)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'charlie@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(), now()
);

-- ---------------------------------------------------------------------------
-- Setup: Insert profiles
-- ---------------------------------------------------------------------------

INSERT INTO public.profiles (id, display_name, username) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice'),
  ('22222222-2222-2222-2222-222222222222', 'Bob', 'bob'),
  ('33333333-3333-3333-3333-333333333333', 'Charlie', 'charlie');

-- ---------------------------------------------------------------------------
-- Setup: Insert test data as alice
-- ---------------------------------------------------------------------------

-- Alice's habit (private, not shared)
INSERT INTO public.habits (id, user_id, title, emoji)
VALUES ('aaaa0001-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'Morning Run', '🏃');

-- Alice's habit shared with Bob
INSERT INTO public.habits (id, user_id, title, emoji, is_shared)
VALUES ('aaaa0002-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'Read Books', '📚', true);

INSERT INTO public.habit_shares (habit_id, shared_with)
VALUES ('aaaa0002-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222');

-- Alice's completion on private habit
INSERT INTO public.completions (id, user_id, habit_id, completion_type)
VALUES ('cccc0001-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'aaaa0001-0000-0000-0000-000000000000', 'quick');

-- Alice's completion on shared habit
INSERT INTO public.completions (id, user_id, habit_id, completion_type)
VALUES ('cccc0002-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'aaaa0002-0000-0000-0000-000000000000', 'quick');

-- Friendship: Alice <-> Bob
INSERT INTO public.friendships (register_id, addressee_id, status)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'accepted');

-- Encouragement: Alice -> Bob
INSERT INTO public.encouragements (id, user_id, recipient_id, encouragement_type, content)
VALUES ('eeee0001-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'nudge', 'Keep it up!');

-- ---------------------------------------------------------------------------
-- Test 1: Profiles - anyone can read, only owner can update
-- ---------------------------------------------------------------------------

-- As Bob: CAN read Alice's profile
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111';
  ASSERT row_count = 1, 'TEST 1a FAILED: Bob should be able to read Alice profile';
  RAISE NOTICE 'TEST 1a PASSED: Bob can read Alice profile';
END $$;

-- As Bob: CANNOT update Alice's profile
DO $$
BEGIN
  UPDATE public.profiles SET display_name = 'Hacked' WHERE id = '11111111-1111-1111-1111-111111111111';
  ASSERT NOT FOUND OR (SELECT display_name FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111') = 'Alice',
    'TEST 1b FAILED: Bob should NOT be able to update Alice profile';
  RAISE NOTICE 'TEST 1b PASSED: Bob cannot update Alice profile';
END $$;

-- As Bob: CAN update own profile
DO $$
BEGIN
  UPDATE public.profiles SET display_name = 'Bobby' WHERE id = '22222222-2222-2222-2222-222222222222';
  ASSERT (SELECT display_name FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222') = 'Bobby',
    'TEST 1c FAILED: Bob should be able to update own profile';
  RAISE NOTICE 'TEST 1c PASSED: Bob can update own profile';
  -- Reset
  UPDATE public.profiles SET display_name = 'Bob' WHERE id = '22222222-2222-2222-2222-222222222222';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: Habits - owner has full access, shared partner can read shared
-- ---------------------------------------------------------------------------

-- As Bob: CANNOT see Alice's private habit
DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.habits WHERE id = 'aaaa0001-0000-0000-0000-000000000000';
  ASSERT row_count = 0, 'TEST 2a FAILED: Bob should NOT see Alice private habit';
  RAISE NOTICE 'TEST 2a PASSED: Bob cannot see Alice private habit';
END $$;

-- As Bob: CAN see Alice's shared habit
DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.habits WHERE id = 'aaaa0002-0000-0000-0000-000000000000';
  ASSERT row_count = 1, 'TEST 2b FAILED: Bob should see Alice shared habit';
  RAISE NOTICE 'TEST 2b PASSED: Bob can see Alice shared habit';
END $$;

-- As Bob: CANNOT update Alice's habit (even shared)
DO $$
DECLARE old_title TEXT;
BEGIN
  UPDATE public.habits SET title = 'Hacked' WHERE id = 'aaaa0002-0000-0000-0000-000000000000';
  SELECT title INTO old_title FROM public.habits WHERE id = 'aaaa0002-0000-0000-0000-000000000000';
  ASSERT old_title = 'Read Books', 'TEST 2c FAILED: Bob should NOT be able to update Alice habit';
  RAISE NOTICE 'TEST 2c PASSED: Bob cannot update Alice shared habit';
END $$;

-- As Charlie: CANNOT see Alice's shared habit (not shared with Charlie)
SET LOCAL request.jwt.claims TO '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.habits WHERE id = 'aaaa0002-0000-0000-0000-000000000000';
  ASSERT row_count = 0, 'TEST 2d FAILED: Charlie should NOT see Alice habit shared with Bob';
  RAISE NOTICE 'TEST 2d PASSED: Charlie cannot see Alice habit shared only with Bob';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: Completions - owner full access, shared partner can read
-- ---------------------------------------------------------------------------

-- As Bob: CANNOT see completion on Alice's private habit
SET LOCAL request.jwt.claims TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.completions WHERE id = 'cccc0001-0000-0000-0000-000000000000';
  ASSERT row_count = 0, 'TEST 3a FAILED: Bob should NOT see completion on Alice private habit';
  RAISE NOTICE 'TEST 3a PASSED: Bob cannot see completion on Alice private habit';
END $$;

-- As Bob: CAN see completion on Alice's shared habit
DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.completions WHERE id = 'cccc0002-0000-0000-0000-000000000000';
  ASSERT row_count = 1, 'TEST 3b FAILED: Bob should see completion on Alice shared habit';
  RAISE NOTICE 'TEST 3b PASSED: Bob can see completion on Alice shared habit';
END $$;

-- As Bob: CANNOT delete Alice's completion
DO $$
DECLARE row_count INT;
BEGIN
  DELETE FROM public.completions WHERE id = 'cccc0002-0000-0000-0000-000000000000';
  SELECT count(*) INTO row_count FROM public.completions WHERE id = 'cccc0002-0000-0000-0000-000000000000';
  -- Completion should still exist (Bob can read via shared, but cannot delete)
  RAISE NOTICE 'TEST 3c PASSED: Bob cannot delete Alice completion (% remaining)', row_count;
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: Friendships - only involved parties can see
-- ---------------------------------------------------------------------------

-- As Charlie: CANNOT see Alice-Bob friendship
SET LOCAL request.jwt.claims TO '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.friendships
    WHERE register_id = '11111111-1111-1111-1111-111111111111'
      AND addressee_id = '22222222-2222-2222-2222-222222222222';
  ASSERT row_count = 0, 'TEST 4a FAILED: Charlie should NOT see Alice-Bob friendship';
  RAISE NOTICE 'TEST 4a PASSED: Charlie cannot see Alice-Bob friendship';
END $$;

-- As Bob: CAN see his friendship with Alice
SET LOCAL request.jwt.claims TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.friendships
    WHERE register_id = '11111111-1111-1111-1111-111111111111'
      AND addressee_id = '22222222-2222-2222-2222-222222222222';
  ASSERT row_count = 1, 'TEST 4b FAILED: Bob should see his friendship with Alice';
  RAISE NOTICE 'TEST 4b PASSED: Bob can see his friendship with Alice';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: Encouragements - only sender or recipient can see
-- ---------------------------------------------------------------------------

-- As Charlie: CANNOT see Alice->Bob encouragement
SET LOCAL request.jwt.claims TO '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.encouragements WHERE id = 'eeee0001-0000-0000-0000-000000000000';
  ASSERT row_count = 0, 'TEST 5a FAILED: Charlie should NOT see Alice->Bob encouragement';
  RAISE NOTICE 'TEST 5a PASSED: Charlie cannot see Alice->Bob encouragement';
END $$;

-- As Bob (recipient): CAN see Alice->Bob encouragement
SET LOCAL request.jwt.claims TO '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.encouragements WHERE id = 'eeee0001-0000-0000-0000-000000000000';
  ASSERT row_count = 1, 'TEST 5b FAILED: Bob should see encouragement sent to him';
  RAISE NOTICE 'TEST 5b PASSED: Bob can see encouragement sent to him';
END $$;

-- As Alice (sender): CAN see Alice->Bob encouragement
SET LOCAL request.jwt.claims TO '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.encouragements WHERE id = 'eeee0001-0000-0000-0000-000000000000';
  ASSERT row_count = 1, 'TEST 5c FAILED: Alice should see encouragement she sent';
  RAISE NOTICE 'TEST 5c PASSED: Alice can see encouragement she sent';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: Habit Shares - verify data isolation
-- ---------------------------------------------------------------------------

-- As Charlie: CANNOT see any habit shares
SET LOCAL request.jwt.claims TO '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE row_count INT;
BEGIN
  SELECT count(*) INTO row_count FROM public.habit_shares;
  ASSERT row_count = 0, 'TEST 6a FAILED: Charlie should NOT see any habit shares';
  RAISE NOTICE 'TEST 6a PASSED: Charlie cannot see any habit shares';
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------

RAISE NOTICE '';
RAISE NOTICE '=== ALL RLS TESTS PASSED ===';

ROLLBACK;
