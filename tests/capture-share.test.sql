-- =============================================================================
-- Capture & share (migration 034)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/capture-share.test.sql
--
-- One upload, many destinations. What matters here is who ends up able to
-- read the file: the DM recipient, the group's members, a partner on any of
-- the habits — and nobody else, including whoever a row was pointed at by
-- someone who does not own the file.
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
-- sender    owns two habits, sends the capture
-- friend    sender's friend, member of the group, push on
-- stranger  no relationship to anyone
-- partner   accepted partner on sender's second habit only

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-sender@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-friend@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('c3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-stranger@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('c4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cs-partner@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Sender', username = 'cs_sender', timezone = 'UTC',
  notification_prefs = '{}'::jsonb
WHERE id = 'c1000000-0000-4000-8000-000000000001';

-- notification_prefs = '{}' so the default quiet hours cannot hold a push back.
UPDATE public.profiles SET display_name = 'Friend', username = 'cs_friend', timezone = 'UTC',
  push_subscription = '{"endpoint":"https://push.test/friend","keys":{"p256dh":"x","auth":"y"}}'::jsonb,
  notification_prefs = '{}'::jsonb
WHERE id = 'c2000000-0000-4000-8000-000000000002';

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'accepted');

INSERT INTO public.habits (id, user_id, title, emoji) VALUES
  ('c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Pray', '🙏'),
  ('c5000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'Walk', '🚶'),
  ('c5000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000003', 'Not yours', '🚫');

INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by) VALUES
  ('c5000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000004', 'accepted', 'c1000000-0000-4000-8000-000000000001');

INSERT INTO public.groups (id, name, created_by)
VALUES ('c6000000-0000-4000-8000-000000000001', 'Capture Circle', 'c1000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('c6000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'admin'),
  ('c6000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'member');

-- ---------------------------------------------------------------------------
-- Test 1: one call reaches two habits, a friend and a group
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE r JSONB;
BEGIN
  r := public.share_capture(
    'c1000000-0000-4000-8000-000000000001/capture/one.webp', 'photo', '  sunrise  ',
    ARRAY['c5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002']::uuid[],
    ARRAY['c2000000-0000-4000-8000-000000000002']::uuid[],
    ARRAY['c6000000-0000-4000-8000-000000000001']::uuid[]
  );

  ASSERT jsonb_array_length(r->'completion_ids') = 2, 'TEST 1 FAILED: expected two check-ins';
  ASSERT jsonb_array_length(r->'encouragement_ids') = 1, 'TEST 1 FAILED: expected one DM';
  ASSERT jsonb_array_length(r->'group_message_ids') = 1, 'TEST 1 FAILED: expected one group message';

  ASSERT (SELECT count(*) FROM public.completions
          WHERE evidence_url = 'c1000000-0000-4000-8000-000000000001/capture/one.webp'
            AND completion_type = 'photo' AND notes = 'sunrise') = 2,
    'TEST 1 FAILED: check-ins should carry the path, type and trimmed caption';
  ASSERT (SELECT media_type FROM public.encouragements
          WHERE id = (r->'encouragement_ids'->>0)::uuid) = 'photo',
    'TEST 1 FAILED: DM should carry the media type';
  RAISE NOTICE 'TEST 1 PASSED: one call reaches two habits, a friend and a group';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: bad destinations are refused, and nothing half-lands
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_before INT;
BEGIN
  SELECT count(*) INTO v_before FROM public.completions WHERE user_id = auth.uid();

  BEGIN
    PERFORM public.share_capture('c1000000-0000-4000-8000-000000000001/capture/x.webp', 'photo', NULL,
      ARRAY['c5000000-0000-4000-8000-000000000001']::uuid[],
      ARRAY['c3000000-0000-4000-8000-000000000003']::uuid[], '{}');
    RAISE EXCEPTION 'TEST 2a FAILED: a non-friend was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  ASSERT (SELECT count(*) FROM public.completions WHERE user_id = auth.uid()) = v_before,
    'TEST 2a FAILED: the habit check-in landed even though the DM was refused';

  BEGIN
    PERFORM public.share_capture('c1000000-0000-4000-8000-000000000001/capture/x.webp', 'photo', NULL,
      '{}', '{}', ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'TEST 2b FAILED: a group the sender is not in was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.share_capture('c1000000-0000-4000-8000-000000000001/capture/x.webp', 'photo', NULL,
      ARRAY['c5000000-0000-4000-8000-000000000003']::uuid[], '{}', '{}');
    RAISE EXCEPTION 'TEST 2c FAILED: someone else''s habit was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.share_capture('c1000000-0000-4000-8000-000000000001/capture/x.webp', 'photo', NULL,
      '{}', '{}', '{}');
    RAISE EXCEPTION 'TEST 2d FAILED: an empty selection was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.share_capture('c3000000-0000-4000-8000-000000000003/capture/theirs.webp', 'photo', NULL,
      '{}', ARRAY['c2000000-0000-4000-8000-000000000002']::uuid[], '{}');
    RAISE EXCEPTION 'TEST 2e FAILED: another user''s file was shared';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'TEST 2 PASSED: non-friend, non-member group, foreign habit, empty selection and foreign file are refused';
END $$;

-- A direct insert pointing at someone else's file is allowed by RLS, but must
-- not grant the recipient anything (checked in test 3).
INSERT INTO public.encouragements (user_id, recipient_id, encouragement_type, media_path, media_type)
VALUES ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'message',
        'c3000000-0000-4000-8000-000000000003/capture/theirs.webp', 'photo');

-- ---------------------------------------------------------------------------
-- Test 3: who can read the file
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"c2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$ BEGIN
  ASSERT public.can_read_capture_media('c1000000-0000-4000-8000-000000000001/capture/one.webp'),
    'TEST 3a FAILED: the DM recipient and group member cannot read it';
  ASSERT NOT public.can_read_capture_media('c3000000-0000-4000-8000-000000000003/capture/theirs.webp'),
    'TEST 3a FAILED: a row pointing at another user''s file granted access to it';
  RAISE NOTICE 'TEST 3a PASSED: the recipient can read it; a forged row grants nothing';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"c4000000-0000-4000-8000-000000000004","role":"authenticated"}';

DO $$ BEGIN
  ASSERT public.can_read_capture_media('c1000000-0000-4000-8000-000000000001/capture/one.webp'),
    'TEST 3b FAILED: a partner on the second habit cannot read it';
  RAISE NOTICE 'TEST 3b PASSED: a partner on any of the habits can read it';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"c3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$ BEGIN
  ASSERT NOT public.can_read_capture_media('c1000000-0000-4000-8000-000000000001/capture/one.webp'),
    'TEST 3c FAILED: a stranger can read it';
  RAISE NOTICE 'TEST 3c PASSED: a stranger cannot';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a group message needs text or media
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$ BEGIN
  INSERT INTO public.group_messages (group_id, user_id, content)
  VALUES ('c6000000-0000-4000-8000-000000000001', auth.uid(), 'plain text still works');

  BEGIN
    INSERT INTO public.group_messages (group_id, user_id, content)
    VALUES ('c6000000-0000-4000-8000-000000000001', auth.uid(), NULL);
    RAISE EXCEPTION 'TEST 4 FAILED: an empty group message was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'TEST 4 PASSED: a group message needs text or media';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: an uncaptioned capture pushes "Sent a photo/video"
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_before INT; p JSONB;
BEGIN
  SELECT count(*) INTO v_before FROM public._sent_push;

  PERFORM public.share_capture('c1000000-0000-4000-8000-000000000001/capture/two.mp4', 'video', NULL,
    '{}', ARRAY['c2000000-0000-4000-8000-000000000002']::uuid[],
    ARRAY['c6000000-0000-4000-8000-000000000001']::uuid[]);

  ASSERT (SELECT count(*) FROM public._sent_push) = v_before + 2,
    'TEST 5 FAILED: expected one DM push and one group push';

  FOR p IN SELECT body FROM public._sent_push ORDER BY id DESC LIMIT 2 LOOP
    ASSERT p->>'body' = '🎥 Sent a video', format('TEST 5 FAILED: wrong body %s', p->>'body');
  END LOOP;

  RAISE NOTICE 'TEST 5 PASSED: an uncaptioned video pushes "Sent a video"';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: today's habits carry their frequency, for the streak's unit
-- ---------------------------------------------------------------------------

RESET role;
INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule) VALUES
  ('c5000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001',
   'Sabbath', '🕯️', 'weekly', '{"days":[0,1,2,3,4,5,6]}'::jsonb),
  ('c5000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001',
   'Plain', NULL, 'daily', '{"days":[0,1,2,3,4,5,6]}'::jsonb);
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$ BEGIN
  ASSERT (SELECT frequency FROM public.get_incomplete_habits_today('UTC')
          WHERE id = 'c5000000-0000-4000-8000-000000000004') = 'weekly',
    'TEST 6 FAILED: a weekly habit should come back as weekly';
  ASSERT (SELECT color FROM public.get_incomplete_habits_today('UTC')
          WHERE id = 'c5000000-0000-4000-8000-000000000004') IS NULL,
    'TEST 6 FAILED: a habit with no color must not get a default one';
  ASSERT (SELECT emoji FROM public.get_incomplete_habits_today('UTC')
          WHERE id = 'c5000000-0000-4000-8000-000000000005') IS NULL,
    'TEST 6 FAILED: a habit with no emoji must not get a default one';
  RAISE NOTICE 'TEST 6 PASSED: today''s habits carry their frequency, and no made-up color or emoji';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL CAPTURE SHARE TESTS PASSED ==='; END $$;

ROLLBACK;
