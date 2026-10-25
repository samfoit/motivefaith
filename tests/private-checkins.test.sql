-- =============================================================================
-- Private check-ins (migration 039)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/private-checkins.test.sql
--
-- A private check-in keeps its note or media for the owner. Partners and
-- groups must see a plain check-in through every door they have: the table,
-- the side table, the file, and the journey/timeline RPCs. The owner must
-- still get it all back.
--
-- pg_net is not installed on a local stack, so `net` is stubbed to record the
-- push the notify trigger would send. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS net;

CREATE TABLE public._sent_push (
  id   SERIAL PRIMARY KEY,
  url  TEXT,
  body JSONB
);

CREATE OR REPLACE FUNCTION net.http_post(
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
-- owner    owns "Pray", which keeps check-ins private by default
-- partner  owner's friend, accepted partner on "Pray", member of the group
-- "Pray" is also shared with the group

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pc-owner@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('d2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pc-partner@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Owner', username = 'pc_owner', timezone = 'UTC',
  notification_prefs = '{}'::jsonb
WHERE id = 'd1000000-0000-4000-8000-000000000001';

UPDATE public.profiles SET display_name = 'Partner', username = 'pc_partner', timezone = 'UTC',
  notification_prefs = '{}'::jsonb
WHERE id = 'd2000000-0000-4000-8000-000000000002';

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ('https://push.test/pc-partner', 'd2000000-0000-4000-8000-000000000002', 'x', 'y');

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'accepted');

INSERT INTO public.habits (id, user_id, title, emoji, private_checkins, schedule) VALUES
  ('d5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Pray', '🙏', true,  '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('d5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'Walk', '🚶', false, '{"days":[0,1,2,3,4,5,6]}'::jsonb);

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by) VALUES
  ('d5000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'accepted', 'd1000000-0000-4000-8000-000000000001'),
  ('d5000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'accepted', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.groups (id, name, created_by)
VALUES ('d6000000-0000-4000-8000-000000000001', 'Private Circle', 'd1000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('d6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'admin'),
  ('d6000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'member');

INSERT INTO public.group_habit_shares (group_id, habit_id, shared_by) VALUES
  ('d6000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');

-- The private photo, where the app puts it.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('completions', 'd1000000-0000-4000-8000-000000000001/private/secret.webp', 'd1000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Test 1: the owner records a private photo
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE c public.completions; v_before INT;
BEGIN
  SELECT count(*) INTO v_before FROM public._sent_push;

  c := public.insert_private_completion(
    'd5000000-0000-4000-8000-000000000001', 'photo',
    'd1000000-0000-4000-8000-000000000001/private/secret.webp', '  just me  ');

  ASSERT c.completion_type = 'quick' AND c.evidence_url IS NULL AND c.notes IS NULL,
    'TEST 1 FAILED: the shared row carries more than a plain check-in';

  ASSERT (SELECT completion_type FROM public.completion_private_content
          WHERE completion_id = c.id) = 'photo',
    'TEST 1 FAILED: the owner cannot read back what they recorded';
  ASSERT (SELECT notes FROM public.completion_private_content
          WHERE completion_id = c.id) = 'just me',
    'TEST 1 FAILED: the note should be kept, trimmed';

  ASSERT (SELECT count(*) FROM storage.objects
          WHERE name = 'd1000000-0000-4000-8000-000000000001/private/secret.webp') = 1,
    'TEST 1 FAILED: the owner cannot read their own private file';

  ASSERT (SELECT streak_current FROM public.habits
          WHERE id = 'd5000000-0000-4000-8000-000000000001') = 1,
    'TEST 1 FAILED: a private check-in should count toward the streak';

  ASSERT (SELECT count(*) FROM public._sent_push) = v_before + 1,
    'TEST 1 FAILED: partners should still be told about the check-in';

  RAISE NOTICE 'TEST 1 PASSED: a private photo is a plain check-in with the content set aside';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: bad input is refused
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  BEGIN
    PERFORM public.insert_private_completion('d5000000-0000-4000-8000-000000000002', 'photo',
      'd1000000-0000-4000-8000-000000000001/d5000000-0000-4000-8000-000000000002/x.webp', NULL);
    RAISE EXCEPTION 'TEST 2a FAILED: media in the habit folder (readable by partners) was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.insert_private_completion('d5000000-0000-4000-8000-000000000002', 'photo',
      'd2000000-0000-4000-8000-000000000002/private/theirs.webp', NULL);
    RAISE EXCEPTION 'TEST 2b FAILED: someone else''s private folder was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.insert_private_completion('d5000000-0000-4000-8000-000000000002', 'message', NULL, '   ');
    RAISE EXCEPTION 'TEST 2c FAILED: an empty private check-in was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.insert_private_completion('d5000000-0000-4000-8000-000000000002', 'rain_check', NULL, 'sick');
    RAISE EXCEPTION 'TEST 2d FAILED: a private rain check was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    INSERT INTO public.completion_private_content (completion_id, user_id, completion_type, notes)
    SELECT id, auth.uid(), 'message', 'sneaky' FROM public.completions LIMIT 1;
    RAISE EXCEPTION 'TEST 2e FAILED: the side table took a direct insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.share_capture('d1000000-0000-4000-8000-000000000001/private/secret.webp', 'photo', NULL,
      ARRAY['d5000000-0000-4000-8000-000000000002']::uuid[],
      ARRAY['d2000000-0000-4000-8000-000000000002']::uuid[], '{}', true);
    RAISE EXCEPTION 'TEST 2f FAILED: a private capture was sent to a friend';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  RAISE NOTICE 'TEST 2 PASSED: shared folders, foreign files, empty content, rain checks, direct inserts and friends are refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the partner sees a plain check-in, everywhere
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"d2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE v_comps JSONB; v_row JSONB;
BEGIN
  ASSERT (SELECT count(*) FROM public.completions
          WHERE habit_id = 'd5000000-0000-4000-8000-000000000001'
            AND completion_type = 'quick' AND evidence_url IS NULL AND notes IS NULL) = 1,
    'TEST 3a FAILED: the partner should see one plain check-in';

  ASSERT (SELECT count(*) FROM public.completion_private_content) = 0,
    'TEST 3b FAILED: the partner can read private content';

  ASSERT (SELECT count(*) FROM storage.objects
          WHERE name = 'd1000000-0000-4000-8000-000000000001/private/secret.webp') = 0,
    'TEST 3c FAILED: the partner can read the private file';
  ASSERT NOT public.can_read_capture_media('d1000000-0000-4000-8000-000000000001/private/secret.webp'),
    'TEST 3c FAILED: can_read_capture_media grants the private file';

  SELECT completions INTO v_comps FROM public.get_friend_journey(
    'd2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001');
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_comps, '[]'::jsonb)) LOOP
    ASSERT v_row->>'evidence_url' IS NULL AND v_row->>'notes' IS NULL
           AND v_row->>'completion_type' = 'quick',
      format('TEST 3d FAILED: the journey leaks %s', v_row);
  END LOOP;
  ASSERT jsonb_array_length(coalesce(v_comps, '[]'::jsonb)) = 1,
    'TEST 3d FAILED: the journey should show the check-in';

  SELECT completions INTO v_comps FROM public.get_group_timeline_activity(
    'd6000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002');
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_comps, '[]'::jsonb)) LOOP
    ASSERT v_row->>'evidence_url' IS NULL AND v_row->>'notes' IS NULL,
      format('TEST 3e FAILED: the group timeline leaks %s', v_row);
  END LOOP;

  RAISE NOTICE 'TEST 3 PASSED: table, side table, file, journey and group timeline show only a plain check-in';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: private captures, and the default today's habits carry
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE r JSONB;
BEGIN
  ASSERT (SELECT private_checkins FROM public.get_incomplete_habits_today('UTC')
          WHERE id = 'd5000000-0000-4000-8000-000000000002') = false,
    'TEST 4a FAILED: today''s habits should carry the private default';

  r := public.share_capture('d1000000-0000-4000-8000-000000000001/private/clip.webm', 'voice', 'quiet',
    ARRAY['d5000000-0000-4000-8000-000000000002']::uuid[], '{}', '{}', true);

  ASSERT (SELECT completion_type FROM public.completions
          WHERE id = (r->'completion_ids'->>0)::uuid) = 'quick',
    'TEST 4b FAILED: a private capture should leave a plain check-in';
  ASSERT (SELECT completion_type || ':' || notes FROM public.completion_private_content
          WHERE completion_id = (r->'completion_ids'->>0)::uuid) = 'voice:quiet',
    'TEST 4b FAILED: a private capture should keep its voice note and caption';

  RAISE NOTICE 'TEST 4 PASSED: a private capture logs the habit and keeps the content';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: the offline batch keeps private items private
-- ---------------------------------------------------------------------------

RESET role;
DELETE FROM public.completions WHERE user_id = 'd1000000-0000-4000-8000-000000000001';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.insert_completions_batch(jsonb_build_array(
    jsonb_build_object('habit_id', 'd5000000-0000-4000-8000-000000000001',
                       'completion_type', 'message', 'notes', 'offline secret', 'is_private', true),
    -- Its photo was lost in the queue: nothing left to keep, so a plain one.
    jsonb_build_object('habit_id', 'd5000000-0000-4000-8000-000000000002',
                       'completion_type', 'photo', 'is_private', true)
  )) b WHERE b.completion_type = 'quick' AND b.notes IS NULL;
  ASSERT n = 2, format('TEST 5 FAILED: expected two plain rows, got %s', n);

  ASSERT (SELECT count(*) FROM public.completion_private_content
          WHERE notes = 'offline secret') = 1,
    'TEST 5 FAILED: the queued note was not kept privately';
  ASSERT (SELECT count(*) FROM public.completion_private_content) = 1,
    'TEST 5 FAILED: an empty private item should not leave a side row';

  RAISE NOTICE 'TEST 5 PASSED: a drained batch keeps private notes private';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL PRIVATE CHECK-IN TESTS PASSED ==='; END $$;

ROLLBACK;
