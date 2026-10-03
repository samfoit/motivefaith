-- =============================================================================
-- Group feed preview tests (migration 033)
-- =============================================================================
-- Run against a local Supabase instance:
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/group-feed-preview.test.sql
--
-- One question throughout: does a group's row in the feed say the same thing
-- as the timeline it opens?
--
-- The timeline shows completions on habits shared to the group *and* on
-- habits joined to the group's active challenges. The preview used to read
-- only the shared ones, so a challenge check-in left the row reading "No
-- activity yet" while the timeline showed it.
--
-- Uses its own users and uuid prefix, so it runs against a seeded database
-- without colliding with seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Setup: alice and bob share a group; alice's habit is in its challenge
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gfeed-alice@test.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gfeed-bob@test.com',   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'GFeed Alice', username = 'gfeed_alice' WHERE id = 'd1000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET display_name = 'GFeed Bob',   username = 'gfeed_bob'   WHERE id = 'd2000000-0000-4000-8000-000000000002';

INSERT INTO public.groups (id, name, created_by)
VALUES ('d5000000-0000-4000-8000-000000000001', 'Prayer Circle', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role)
VALUES
  ('d5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'member')
ON CONFLICT (group_id, user_id) DO NOTHING;

INSERT INTO public.habits (id, user_id, title, emoji)
VALUES ('d9000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Read Psalms', '📖');

INSERT INTO public.group_challenges (id, group_id, title, created_by)
VALUES ('d6000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'Psalms in 30', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.group_challenge_participants (challenge_id, user_id, habit_id)
VALUES ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001');

INSERT INTO public.completions (id, user_id, habit_id, completion_type, completed_at)
VALUES ('da000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', 'quick', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Test 1: a challenge check-in reaches the group's feed row
-- ---------------------------------------------------------------------------
-- The reported bug, seen by both members: the one who checked in and the one
-- who did not.

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE v_row RECORD;
BEGIN
  SELECT * INTO v_row
  FROM get_feed_groups_latest_completions(
    'd2000000-0000-4000-8000-000000000002',
    ARRAY['d5000000-0000-4000-8000-000000000001']::uuid[]);

  ASSERT v_row.user_id = 'd1000000-0000-4000-8000-000000000001',
    'TEST 1a FAILED: a member does not see the challenge check-in in the group preview';
  ASSERT v_row.habit_title = 'Read Psalms',
    'TEST 1a FAILED: wrong habit on the preview';
  RAISE NOTICE 'TEST 1a PASSED: a challenge check-in reaches the group row';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM get_feed_groups_latest_completions(
    'd1000000-0000-4000-8000-000000000001',
    ARRAY['d5000000-0000-4000-8000-000000000001']::uuid[]);

  ASSERT v_count = 1,
    'TEST 1b FAILED: your own challenge check-in is missing from your group row';
  RAISE NOTICE 'TEST 1b PASSED: your own challenge check-in reaches your group row';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the row agrees with the timeline it opens
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_preview INT; v_timeline INT;
BEGIN
  SELECT count(*) INTO v_preview
  FROM get_feed_groups_latest_completions(
    'd1000000-0000-4000-8000-000000000001',
    ARRAY['d5000000-0000-4000-8000-000000000001']::uuid[]);

  SELECT jsonb_array_length(coalesce(completions, '[]'::jsonb)) INTO v_timeline
  FROM get_group_timeline_activity(
    'd5000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001');

  ASSERT (v_preview > 0) = (v_timeline > 0),
    format('TEST 2 FAILED: preview has %s rows, timeline holds %s completions',
           v_preview, v_timeline);
  RAISE NOTICE 'TEST 2 PASSED: the row and the timeline agree';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: an ended challenge drops out of both
-- ---------------------------------------------------------------------------
-- The timeline only reads active challenges; the preview must not resurrect
-- one the timeline no longer shows.

RESET role;
UPDATE public.group_challenges SET is_active = false
WHERE id = 'd6000000-0000-4000-8000-000000000001';

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_preview INT; v_timeline INT;
BEGIN
  SELECT count(*) INTO v_preview
  FROM get_feed_groups_latest_completions(
    'd1000000-0000-4000-8000-000000000001',
    ARRAY['d5000000-0000-4000-8000-000000000001']::uuid[]);

  SELECT jsonb_array_length(coalesce(completions, '[]'::jsonb)) INTO v_timeline
  FROM get_group_timeline_activity(
    'd5000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001');

  ASSERT v_preview = 0 AND v_timeline = 0,
    format('TEST 3 FAILED: after the challenge ended, preview %s, timeline %s',
           v_preview, v_timeline);
  RAISE NOTICE 'TEST 3 PASSED: an ended challenge leaves both';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL GROUP FEED PREVIEW TESTS PASSED ==='; END $$;

ROLLBACK;
