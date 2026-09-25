-- =============================================================================
-- Feed preview tests (migration 032)
-- =============================================================================
-- Run against a local Supabase instance:
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/feed-preview.test.sql
--
-- One question throughout: does a friend's row in the feed say the same thing
-- as the conversation it opens?
--
-- The row is a preview of `get_friend_journey`, which shows completions from
-- both people on the habits they share. `get_feed_friends` used to count only
-- the friend's, so checking in on your own habit — the ordinary case — left
-- the row reading "No shared activity yet" while the thread behind it showed
-- the check-in.
--
-- Test 3 is the one that keeps the fix honest: 014 removed own completions to
-- stop them masking the friend's activity, and that concern is still valid.
-- The answer is ordering, not exclusion — whoever acted last is the preview.
--
-- Uses its own users and uuid prefix, so it runs against a seeded database
-- without colliding with seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Setup: alice owns the habit, bob is an accepted partner on it
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feed-alice@test.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feed-bob@test.com',   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Feed Alice', username = 'feed_alice' WHERE id = 'c1000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET display_name = 'Feed Bob',   username = 'feed_bob'   WHERE id = 'c2000000-0000-4000-8000-000000000002';

INSERT INTO public.friendships (register_id, addressee_id, status)
VALUES ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'accepted');

INSERT INTO public.habits (id, user_id, title, emoji)
VALUES ('c9000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Morning Prayer', '🙏');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by)
VALUES ('c9000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'accepted', 'c1000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Test 1: the owner's own check-in reaches their own feed row
-- ---------------------------------------------------------------------------
-- The reported bug. Alice checks in on her habit; Bob follows it; Alice's feed
-- row for Bob must not claim the shared thread is empty.

INSERT INTO public.completions (id, user_id, habit_id, completion_type, completed_at)
VALUES ('ca000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'quick', now() - interval '2 hours');

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_comp JSONB;
BEGIN
  SELECT latest_completion INTO v_comp
  FROM get_feed_friends('c1000000-0000-4000-8000-000000000001');

  ASSERT v_comp IS NOT NULL,
    'TEST 1a FAILED: the owner''s own check-in is missing from their feed row';
  ASSERT v_comp ->> 'user_id' = 'c1000000-0000-4000-8000-000000000001',
    'TEST 1a FAILED: wrong actor on the preview';
  RAISE NOTICE 'TEST 1a PASSED: your own check-in reaches your own feed row';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the row agrees with the thread it opens
-- ---------------------------------------------------------------------------
-- The two are one feature. A preview that disagrees with the conversation
-- behind it is the whole defect, whichever way round it points.

DO $$
DECLARE v_comp JSONB; v_journey INT;
BEGIN
  SELECT latest_completion INTO v_comp
  FROM get_feed_friends('c1000000-0000-4000-8000-000000000001');

  SELECT jsonb_array_length(coalesce(completions, '[]'::jsonb)) INTO v_journey
  FROM get_friend_journey(
    'c1000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000002');

  ASSERT (v_comp IS NOT NULL) = (v_journey > 0),
    format('TEST 2 FAILED: feed says %s, thread holds %s completions',
           coalesce(v_comp ->> 'completed_at', 'nothing'), v_journey);
  RAISE NOTICE 'TEST 2 PASSED: the row and the thread agree';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the most recent check-in wins, whoever made it
-- ---------------------------------------------------------------------------
-- What 014 was actually protecting: your own activity must not mask your
-- friend's. Ordering does that without hiding anything — bob checks in after
-- alice, so bob is the preview.

RESET role;
INSERT INTO public.completions (id, user_id, habit_id, completion_type, completed_at)
VALUES ('ca000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'quick', now());

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_comp JSONB;
BEGIN
  SELECT latest_completion INTO v_comp
  FROM get_feed_friends('c1000000-0000-4000-8000-000000000001');

  ASSERT v_comp ->> 'user_id' = 'c2000000-0000-4000-8000-000000000002',
    'TEST 3 FAILED: the viewer''s older check-in masked the friend''s newer one';
  RAISE NOTICE 'TEST 3 PASSED: the latest check-in is the preview, whoever made it';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL FEED PREVIEW TESTS PASSED ==='; END $$;

ROLLBACK;
