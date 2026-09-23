-- =============================================================================
-- Partnership push notifications (migration 030)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/partner-notifications.test.sql
--
-- notify_habit_partner() decides three things, and all three are easy to get
-- quietly wrong: WHETHER to send, WHO to send to, and WHERE tapping should
-- land. None of that is visible from the app, and a mistake looks like silence
-- rather than an error — so it is tested here rather than by hand.
--
-- The trigger's side effect is a net.http_post, and pg_net is not installed on
-- a local stack, so this stubs `net` with a function that records the call.
-- Everything, the stub included, is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Stub the outbound call and the secrets that gate it
-- ---------------------------------------------------------------------------

CREATE SCHEMA net;

CREATE TABLE public._sent_push (
  id   SERIAL PRIMARY KEY,
  url  TEXT,
  body JSONB
);

-- Named parameters must match the trigger's call: url, headers, body.
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

SELECT vault.create_secret('http://stub', 'supabase_url');
SELECT vault.create_secret('stub-service-key', 'service_role_key');

-- How many pushes went out since the last checkpoint, and what was the latest?
CREATE FUNCTION public._push_count() RETURNS INT
LANGUAGE sql AS $fn$ SELECT count(*)::int FROM public._sent_push $fn$;

CREATE FUNCTION public._last_push() RETURNS JSONB
LANGUAGE sql AS $fn$
  SELECT body FROM public._sent_push ORDER BY id DESC LIMIT 1
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner  owns the habits, has push on
-- pal    friend of owner, has push on
-- mute   friend of owner, has push but partner_alerts off

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('f1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pn-owner@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('f2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pn-pal@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('f3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pn-mute@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET
  display_name = 'Owner', username = 'pn_owner', timezone = 'UTC',
  push_subscription = '{"endpoint":"https://push.test/owner","keys":{"p256dh":"x","auth":"y"}}'::jsonb
WHERE id = 'f1000000-0000-4000-8000-000000000001';

UPDATE public.profiles SET
  display_name = 'Pal', username = 'pn_pal', timezone = 'UTC',
  push_subscription = '{"endpoint":"https://push.test/pal","keys":{"p256dh":"x","auth":"y"}}'::jsonb
WHERE id = 'f2000000-0000-4000-8000-000000000002';

UPDATE public.profiles SET
  display_name = 'Mute', username = 'pn_mute', timezone = 'UTC',
  push_subscription = '{"endpoint":"https://push.test/mute","keys":{"p256dh":"x","auth":"y"}}'::jsonb,
  notification_prefs = '{"partner_alerts": false}'::jsonb
WHERE id = 'f3000000-0000-4000-8000-000000000003';

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000002', 'accepted'),
  ('f1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003', 'accepted');

INSERT INTO public.habits (id, user_id, title, emoji, visibility) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Morning Run', '🏃', 'public'),
  ('e2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'Journal', '📓', 'private');

-- ---------------------------------------------------------------------------
-- Test 1: an invitation reaches the person invited
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE p JSONB;
BEGIN
  PERFORM public.invite_habit_partner(
    'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002');

  ASSERT public._push_count() = 1, 'TEST 1 FAILED: expected exactly one push, got %', public._push_count();
  p := public._last_push();
  ASSERT p->>'user_id' = 'f2000000-0000-4000-8000-000000000002',
    'TEST 1 FAILED: invitation went to the wrong person';
  ASSERT p->>'type' = 'partner_request', 'TEST 1 FAILED: wrong type %', p->>'type';
  ASSERT p->>'url' = '/main/inbox', 'TEST 1 FAILED: wrong url %', p->>'url';
  ASSERT p->>'title' LIKE '%invited you to follow Journal%',
    'TEST 1 FAILED: wrong wording: %', p->>'title';
  RAISE NOTICE 'TEST 1 PASSED: an invitation notifies the invitee, and points at the inbox';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: accepting it tells the person who asked, and points at their habit
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"f2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE v_share UUID; p JSONB;
BEGIN
  SELECT id INTO v_share FROM public.habit_shares
   WHERE habit_id = 'e2000000-0000-4000-8000-000000000002' AND shared_with = auth.uid();
  PERFORM public.respond_habit_partner(v_share, true);

  ASSERT public._push_count() = 2, 'TEST 2 FAILED: expected one more push, total %', public._push_count();
  p := public._last_push();
  ASSERT p->>'user_id' = 'f1000000-0000-4000-8000-000000000001',
    'TEST 2 FAILED: acceptance should notify the owner who invited';
  ASSERT p->>'type' = 'partner_accepted', 'TEST 2 FAILED: wrong type %', p->>'type';
  ASSERT p->>'url' = '/main/habits/e2000000-0000-4000-8000-000000000002',
    'TEST 2 FAILED: should land on the owner''s own habit, got %', p->>'url';
  ASSERT p->>'title' LIKE '%is now following Journal%',
    'TEST 2 FAILED: wrong wording: %', p->>'title';
  RAISE NOTICE 'TEST 2 PASSED: acceptance notifies the inviter and opens their habit';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a request reaches the owner; accepting it sends the asker to the
--         owner's page, not to a habit they do not own
-- ---------------------------------------------------------------------------

DO $$
DECLARE p JSONB;
BEGIN
  -- still Pal: asks to watch the public habit
  PERFORM public.request_habit_partner('e1000000-0000-4000-8000-000000000001');

  ASSERT public._push_count() = 3, 'TEST 3a FAILED: expected a push for the request';
  p := public._last_push();
  ASSERT p->>'user_id' = 'f1000000-0000-4000-8000-000000000001',
    'TEST 3a FAILED: a request should notify the habit owner';
  ASSERT p->>'title' LIKE '%asked to follow Morning Run%',
    'TEST 3a FAILED: wrong wording: %', p->>'title';
  RAISE NOTICE 'TEST 3a PASSED: a request notifies the owner';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_share UUID; p JSONB;
BEGIN
  SELECT id INTO v_share FROM public.habit_shares
   WHERE habit_id = 'e1000000-0000-4000-8000-000000000001'
     AND shared_with = 'f2000000-0000-4000-8000-000000000002';
  PERFORM public.respond_habit_partner(v_share, true);

  ASSERT public._push_count() = 4, 'TEST 3b FAILED: expected a push for the acceptance';
  p := public._last_push();
  ASSERT p->>'user_id' = 'f2000000-0000-4000-8000-000000000002',
    'TEST 3b FAILED: should notify the friend who asked';
  ASSERT p->>'url' = '/main/feed/f1000000-0000-4000-8000-000000000001',
    'TEST 3b FAILED: should open the owner''s page, got %', p->>'url';
  RAISE NOTICE 'TEST 3b PASSED: an accepted request opens the owner''s page';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a muted invitee hears nothing, and a decline is silent
-- ---------------------------------------------------------------------------
-- Fixture edits run as postgres from here on. Under `authenticated` an UPDATE
-- to someone else's profile is not an error — RLS simply matches no rows, so
-- the fixture silently does not happen and the test passes for the wrong
-- reason. That is exactly what went wrong the first time this was written.

SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003');

  ASSERT public._push_count() = v_before,
    'TEST 4a FAILED: partner_alerts=false should suppress the invite, got %', public._push_count();
  RAISE NOTICE 'TEST 4a PASSED: partner_alerts=false suppresses the invitation';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"f3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
DECLARE v_share UUID; v_before INT;
BEGIN
  v_before := public._push_count();
  SELECT id INTO v_share FROM public.habit_shares
   WHERE habit_id = 'e1000000-0000-4000-8000-000000000001' AND shared_with = auth.uid();
  ASSERT v_share IS NOT NULL, 'TEST 4b FAILED: the invitation row is missing';

  PERFORM public.respond_habit_partner(v_share, false);

  ASSERT public._push_count() = v_before,
    'TEST 4b FAILED: declining should notify nobody, count went to %', public._push_count();
  RAISE NOTICE 'TEST 4b PASSED: a decline is silent — no is a complete answer';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: re-inviting after a decline notifies again (the UPDATE path)
-- ---------------------------------------------------------------------------

RESET role;
UPDATE public.profiles SET notification_prefs = '{}'::jsonb
 WHERE id = 'f3000000-0000-4000-8000-000000000003';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003');

  -- declined -> pending is an UPDATE, not an INSERT. A trigger that only
  -- watched INSERT would go quiet here and the re-invitation would never
  -- reach anyone.
  ASSERT public._push_count() = v_before + 1,
    'TEST 5 FAILED: re-inviting after a decline sent no push';
  RAISE NOTICE 'TEST 5 PASSED: re-inviting after a decline notifies again';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: re-inviting an accepted partner says nothing
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002');

  ASSERT public._push_count() = v_before,
    'TEST 6 FAILED: re-inviting an existing partner should be silent';
  RAISE NOTICE 'TEST 6 PASSED: re-inviting an accepted partner is silent';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: the other three gates
-- ---------------------------------------------------------------------------
-- Each resets the invitation so the next invite is a fresh pending row.

-- (a) notifications off wholesale
RESET role;
UPDATE public.profiles SET notification_prefs = '{"enabled": false}'::jsonb
 WHERE id = 'f3000000-0000-4000-8000-000000000003';
DELETE FROM public.habit_shares
 WHERE habit_id = 'e1000000-0000-4000-8000-000000000001'
   AND shared_with = 'f3000000-0000-4000-8000-000000000003';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003');
  ASSERT public._push_count() = v_before, 'TEST 7a FAILED: enabled=false should suppress';
  RAISE NOTICE 'TEST 7a PASSED: enabled=false suppresses';
END $$;

-- (b) no push subscription at all
RESET role;
UPDATE public.profiles SET notification_prefs = '{}'::jsonb, push_subscription = NULL
 WHERE id = 'f3000000-0000-4000-8000-000000000003';
DELETE FROM public.habit_shares
 WHERE habit_id = 'e1000000-0000-4000-8000-000000000001'
   AND shared_with = 'f3000000-0000-4000-8000-000000000003';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003');
  ASSERT public._push_count() = v_before, 'TEST 7b FAILED: no subscription should suppress';
  RAISE NOTICE 'TEST 7b PASSED: an unsubscribed profile is skipped';
END $$;

-- (c) quiet hours — a window an hour either side of now
RESET role;
UPDATE public.profiles SET
  push_subscription = '{"endpoint":"https://push.test/mute","keys":{"p256dh":"x","auth":"y"}}'::jsonb,
  notification_prefs = jsonb_build_object(
    'quiet_start', to_char(now() - interval '1 hour', 'HH24:MI'),
    'quiet_end',   to_char(now() + interval '1 hour', 'HH24:MI')
  )
 WHERE id = 'f3000000-0000-4000-8000-000000000003';
DELETE FROM public.habit_shares
 WHERE habit_id = 'e1000000-0000-4000-8000-000000000001'
   AND shared_with = 'f3000000-0000-4000-8000-000000000003';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003');
  ASSERT public._push_count() = v_before, 'TEST 7c FAILED: quiet hours should suppress';
  RAISE NOTICE 'TEST 7c PASSED: quiet hours suppress';
END $$;

-- (d) and with the window moved off `now`, the same invitation does land —
--     so 7a-7c are suppression, not three ways of silently doing nothing.
RESET role;
UPDATE public.profiles SET
  notification_prefs = jsonb_build_object(
    'quiet_start', to_char(now() + interval '3 hours', 'HH24:MI'),
    'quiet_end',   to_char(now() + interval '5 hours', 'HH24:MI')
  )
 WHERE id = 'f3000000-0000-4000-8000-000000000003';
DELETE FROM public.habit_shares
 WHERE habit_id = 'e1000000-0000-4000-8000-000000000001'
   AND shared_with = 'f3000000-0000-4000-8000-000000000003';
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_before INT;
BEGIN
  v_before := public._push_count();
  PERFORM public.invite_habit_partner(
    'e1000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000003');
  ASSERT public._push_count() = v_before + 1,
    'TEST 7d FAILED: outside quiet hours the invitation should be delivered';
  RAISE NOTICE 'TEST 7d PASSED: outside quiet hours the same invitation lands';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL PARTNER NOTIFICATION TESTS PASSED ==='; END $$;

ROLLBACK;
