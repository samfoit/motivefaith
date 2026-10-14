-- =============================================================================
-- Per-device push subscriptions (migration 036)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/push-subscriptions.test.sql
--
-- A user used to hold one subscription, and each device that opened the
-- profile page overwrote it — so only the last device got notifications. Now
-- every device keeps its own row and send-push fans out by user_id. This
-- checks the client RPCs that maintain those rows and that triggers name the
-- recipient rather than a single subscription.
--
-- pg_net is not installed on a local stack, so `net` is stubbed with a
-- function that records the call. Everything is rolled back at the end.
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

-- SECURITY DEFINER: the table has RLS and no client policies, so counting as
-- `authenticated` would always see zero.
CREATE FUNCTION public._devices(p_user UUID) RETURNS INT
LANGUAGE sql SECURITY DEFINER AS $fn$
  SELECT count(*)::int FROM public.push_subscriptions WHERE user_id = p_user
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- alice  has two devices
-- bob    signs in on one of alice's devices later on
--
-- notification_prefs = '{}' so the default quiet hours cannot hold a push back.

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ps-alice@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('b5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ps-bob@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Alice', username = 'ps_alice', timezone = 'UTC',
  notification_prefs = '{}'::jsonb
WHERE id = 'a5000000-0000-4000-8000-000000000001';

UPDATE public.profiles SET display_name = 'Bob', username = 'ps_bob', timezone = 'UTC',
  notification_prefs = '{}'::jsonb
WHERE id = 'b5000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Test 1: each device keeps its own row
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  PERFORM public.save_push_subscription('https://web.push.apple.com/alice-phone', 'k1', 'a1');
  PERFORM public.save_push_subscription('https://fcm.googleapis.com/alice-laptop', 'k2', 'a2');
  ASSERT public._devices('a5000000-0000-4000-8000-000000000001') = 2,
    'TEST 1 FAILED: a second device replaced the first';
  RAISE NOTICE 'TEST 1 PASSED: a second device does not displace the first';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: re-saving a device refreshes it instead of duplicating it
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM public.save_push_subscription('https://web.push.apple.com/alice-phone', 'k1-new', 'a1-new');
  ASSERT public._devices('a5000000-0000-4000-8000-000000000001') = 2,
    'TEST 2 FAILED: re-saving duplicated the device';
  RAISE NOTICE 'TEST 2 PASSED: re-saving a device updates it in place';
END $$;

RESET role;
DO $$
BEGIN
  ASSERT (SELECT p256dh FROM public.push_subscriptions
          WHERE endpoint = 'https://web.push.apple.com/alice-phone') = 'k1-new',
    'TEST 2 FAILED: keys were not refreshed';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a device that signs into another account moves with it
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"b5000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  PERFORM public.save_push_subscription('https://fcm.googleapis.com/alice-laptop', 'k3', 'a3');
  ASSERT public._devices('a5000000-0000-4000-8000-000000000001') = 1,
    'TEST 3 FAILED: the previous account still holds the device';
  ASSERT public._devices('b5000000-0000-4000-8000-000000000002') = 1,
    'TEST 3 FAILED: the new account did not get the device';
  RAISE NOTICE 'TEST 3 PASSED: a shared device notifies only whoever signed in last';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: deleting touches only your own device
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- bob cannot remove alice's phone
  PERFORM public.delete_push_subscription('https://web.push.apple.com/alice-phone');
  ASSERT public._devices('a5000000-0000-4000-8000-000000000001') = 1,
    'TEST 4 FAILED: removed another user''s device';

  PERFORM public.delete_push_subscription('https://fcm.googleapis.com/alice-laptop');
  ASSERT public._devices('b5000000-0000-4000-8000-000000000002') = 0,
    'TEST 4 FAILED: could not remove own device';
  RAISE NOTICE 'TEST 4 PASSED: delete is scoped to the caller''s own devices';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: a non-HTTPS endpoint is refused
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    PERFORM public.save_push_subscription('http://169.254.169.254/latest', 'k', 'a');
    RAISE EXCEPTION 'TEST 5 FAILED: accepted a non-HTTPS endpoint';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'TEST 5 FAILED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'TEST 5 PASSED: a non-HTTPS endpoint is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a user's devices are capped at 10, oldest dropped first
-- ---------------------------------------------------------------------------

RESET role;
INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth, updated_at)
SELECT 'https://fcm.googleapis.com/old-' || i, 'b5000000-0000-4000-8000-000000000002', 'k', 'a',
       now() - make_interval(days => i)
FROM generate_series(1, 10) AS i;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"b5000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  PERFORM public.save_push_subscription('https://fcm.googleapis.com/newest', 'k', 'a');
  ASSERT public._devices('b5000000-0000-4000-8000-000000000002') = 10,
    format('TEST 6 FAILED: expected 10 devices, got %s', public._devices('b5000000-0000-4000-8000-000000000002'));
END $$;

RESET role;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.push_subscriptions
                     WHERE endpoint = 'https://fcm.googleapis.com/old-10'),
    'TEST 6 FAILED: the oldest device survived';
  ASSERT EXISTS (SELECT 1 FROM public.push_subscriptions
                 WHERE endpoint = 'https://fcm.googleapis.com/newest'),
    'TEST 6 FAILED: the newest device was dropped';
  RAISE NOTICE 'TEST 6 PASSED: devices are capped at 10, oldest first';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: a trigger sends one request per recipient, naming the user
-- ---------------------------------------------------------------------------
-- send-push fans out to the devices, so two devices must not mean two calls,
-- and the payload must not carry a subscription of its own.

RESET role;
INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
VALUES ('https://fcm.googleapis.com/alice-tablet', 'a5000000-0000-4000-8000-000000000001', 'k', 'a');

DO $$
DECLARE p JSONB;
BEGIN
  ASSERT public._devices('a5000000-0000-4000-8000-000000000001') = 2, 'TEST 7 setup: alice should have two devices';

  INSERT INTO public.encouragements (user_id, recipient_id, content)
  VALUES ('b5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'Keep going');

  ASSERT (SELECT count(*) FROM public._sent_push) = 1,
    format('TEST 7 FAILED: expected one call, got %s', (SELECT count(*) FROM public._sent_push));
  SELECT body INTO p FROM public._sent_push;
  ASSERT p->>'user_id' = 'a5000000-0000-4000-8000-000000000001', 'TEST 7 FAILED: wrong recipient';
  ASSERT NOT (p ? 'subscription'), 'TEST 7 FAILED: payload still carries a subscription';
  RAISE NOTICE 'TEST 7 PASSED: one call per recipient, fan-out left to send-push';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: no devices, no call
-- ---------------------------------------------------------------------------

DELETE FROM public.push_subscriptions WHERE user_id = 'a5000000-0000-4000-8000-000000000001';

DO $$
DECLARE v_before INT := (SELECT count(*) FROM public._sent_push);
BEGIN
  INSERT INTO public.encouragements (user_id, recipient_id, content)
  VALUES ('b5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'Again');
  ASSERT (SELECT count(*) FROM public._sent_push) = v_before,
    'TEST 8 FAILED: pushed to a user with no devices';
  RAISE NOTICE 'TEST 8 PASSED: a user with no devices is skipped';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9: clients cannot call the reminder RPC
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT NOT has_function_privilege('authenticated', 'public.get_habits_due_for_reminder(timestamptz)', 'EXECUTE'),
    'TEST 9 FAILED: authenticated can read every user''s due habits';
  ASSERT NOT has_function_privilege('anon', 'public.get_habits_due_for_reminder(timestamptz)', 'EXECUTE'),
    'TEST 9 FAILED: anon can read every user''s due habits';
  ASSERT has_function_privilege('service_role', 'public.get_habits_due_for_reminder(timestamptz)', 'EXECUTE'),
    'TEST 9 FAILED: service_role lost access';
  RAISE NOTICE 'TEST 9 PASSED: only service_role can list due reminders';
END $$;

DO $$ BEGIN RAISE NOTICE '=== ALL PUSH SUBSCRIPTION TESTS PASSED ==='; END $$;

ROLLBACK;
