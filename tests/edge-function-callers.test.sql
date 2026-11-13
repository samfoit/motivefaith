-- =============================================================================
-- Only this project calls its functions (migration 055)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/edge-function-callers.test.sql
--
-- The functions check a caller's key themselves. When that key is the vault's
-- legacy service_role JWT they ask the database, through
-- caller_is_service_role(), so that question must be closed to everyone but
-- the service role. Cron reaches the functions through invoke_edge_function(),
-- which reads the vault each time instead of carrying a key in its command.
--
-- pg_net is not installed on a local stack, so `net` is stubbed to record
-- what would be sent, and pg_cron is created for the length of this
-- transaction. Everything is rolled back at the end.
--
-- What this cannot show is the other half: that a forged token never reaches
-- Postgres at all. The API refuses it on its signature; tests/internal-caller
-- .test.ts covers what the functions do with that refusal.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA net;

CREATE TABLE public._sent_call (
  id      SERIAL PRIMARY KEY,
  url     TEXT,
  headers JSONB,
  body    JSONB
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
  INSERT INTO public._sent_call (url, headers, body) VALUES (url, headers, body);
  RETURN 1;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Test 1: only the service role can ask whether it is the service role
-- ---------------------------------------------------------------------------

SET LOCAL role TO anon;

DO $$
BEGIN
  BEGIN
    PERFORM public.caller_is_service_role();
    RAISE EXCEPTION 'TEST 1 FAILED: signed out, the question was answered';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
SET LOCAL role TO authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM public.caller_is_service_role();
    RAISE EXCEPTION 'TEST 1 FAILED: signed in, the question was answered';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL role TO service_role;

DO $$
BEGIN
  IF public.caller_is_service_role() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 1 FAILED: the service role was not recognised';
  END IF;
END $$;

RESET role;
SELECT set_config('request.jwt.claims', '', true);

DO $$
BEGIN
  -- No request at all (a migration, cron): not the service role, and no error.
  IF public.caller_is_service_role() IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST 1 FAILED: a session with no claims counted as the service role';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: only the service role can ask, and only it gets yes';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: with no vault secrets, nothing is sent
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM public.invoke_edge_function('check-missed-habits');
  IF EXISTS (SELECT 1 FROM public._sent_call) THEN
    RAISE EXCEPTION 'TEST 2 FAILED: a call went out with no key to send';
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: no vault secrets, no call';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: the call carries the vault's key, read when it is made
-- ---------------------------------------------------------------------------

SELECT vault.create_secret('http://stub', 'supabase_url');
SELECT vault.create_secret('first-service-key', 'service_role_key');

DO $$
DECLARE
  v_call RECORD;
BEGIN
  PERFORM public.invoke_edge_function('check-missed-habits');

  SELECT * INTO v_call FROM public._sent_call ORDER BY id DESC LIMIT 1;
  IF v_call.url IS DISTINCT FROM 'http://stub/functions/v1/check-missed-habits' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: called %', v_call.url;
  END IF;
  IF v_call.headers ->> 'Authorization' IS DISTINCT FROM 'Bearer first-service-key'
     OR v_call.headers ->> 'apikey' IS DISTINCT FROM 'first-service-key' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: sent headers %', v_call.headers;
  END IF;

  -- The key is rotated: the next call carries the new one, with nothing
  -- re-registered.
  PERFORM vault.update_secret(
    (SELECT id FROM vault.secrets WHERE name = 'service_role_key'),
    'second-service-key'
  );
  PERFORM public.invoke_edge_function('habit-reminders');

  SELECT * INTO v_call FROM public._sent_call ORDER BY id DESC LIMIT 1;
  IF v_call.url IS DISTINCT FROM 'http://stub/functions/v1/habit-reminders'
     OR v_call.headers ->> 'apikey' IS DISTINCT FROM 'second-service-key' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: after rotating, sent % to %', v_call.headers, v_call.url;
  END IF;

  RAISE NOTICE 'TEST 3 PASSED: each call reads the key from the vault';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: it is nobody else's to call, and takes only a function's name
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_before INT;
BEGIN
  SELECT count(*) INTO v_before FROM public._sent_call;

  BEGIN
    PERFORM public.invoke_edge_function('send-push/../../rest/v1/profiles');
    RAISE EXCEPTION 'TEST 4 FAILED: a path was taken for a function name';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'invoke_edge_function: not a function name%' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public._sent_call) <> v_before THEN
    RAISE EXCEPTION 'TEST 4 FAILED: a refused name still sent a call';
  END IF;
END $$;

SET LOCAL role TO anon;

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT public.invoke_edge_function('send-push')$q$,
    $q$SELECT public.schedule_edge_function('send-push', '* * * * *')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 4 FAILED: anon could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

RESET role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
SET LOCAL role TO authenticated;

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT public.invoke_edge_function('send-push')$q$,
    $q$SELECT public.schedule_edge_function('send-push', '* * * * *')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 4 FAILED: a signed-in user could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'TEST 4 PASSED: only a function name is taken, and only from the database itself';
END $$;

RESET role;
SELECT set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Test 5: cron is pointed at it without losing its schedule
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF public.schedule_edge_function('check-missed-habits', '0 * * * *') <> 'skipped' THEN
    RAISE EXCEPTION 'TEST 5 FAILED: scheduled something with no pg_cron to schedule it in';
  END IF;
END $$;

CREATE EXTENSION pg_cron;

-- As 015 left it: the key written into the command. And one someone has
-- since moved to its own schedule and switched off.
SELECT cron.schedule(
  'check-missed-habits',
  '0 * * * *',
  $cmd$SELECT net.http_post(url := 'http://stub/functions/v1/check-missed-habits', headers := '{"Authorization": "Bearer baked-in-key"}'::jsonb, body := '{}'::jsonb)$cmd$
);
SELECT cron.schedule('habit-reminders', '*/5 * * * *', 'SELECT 1');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'habit-reminders'), active := false);

DO $$
DECLARE
  v_job RECORD;
  v_result TEXT;
BEGIN
  v_result := public.schedule_edge_function('check-missed-habits', '30 * * * *');
  SELECT * INTO v_job FROM cron.job WHERE jobname = 'check-missed-habits';
  IF v_result <> 'updated'
     OR v_job.command <> $c$SELECT public.invoke_edge_function('check-missed-habits')$c$
     OR v_job.schedule <> '0 * * * *' THEN
    RAISE EXCEPTION 'TEST 5 FAILED: %, now runs "%" on "%"', v_result, v_job.command, v_job.schedule;
  END IF;
  IF v_job.command LIKE '%baked-in-key%' THEN
    RAISE EXCEPTION 'TEST 5 FAILED: the key is still in the command';
  END IF;

  v_result := public.schedule_edge_function('habit-reminders', '*/15 * * * *');
  SELECT * INTO v_job FROM cron.job WHERE jobname = 'habit-reminders';
  IF v_result <> 'updated' OR v_job.schedule <> '*/5 * * * *' OR v_job.active THEN
    RAISE EXCEPTION 'TEST 5 FAILED: habit-reminders came back on "%", active %', v_job.schedule, v_job.active;
  END IF;

  v_result := public.schedule_edge_function('weekly-summary', '0 * * * *');
  SELECT * INTO v_job FROM cron.job WHERE jobname = 'weekly-summary';
  IF v_result <> 'created'
     OR v_job.schedule <> '0 * * * *'
     OR v_job.command <> $c$SELECT public.invoke_edge_function('weekly-summary')$c$ THEN
    RAISE EXCEPTION 'TEST 5 FAILED: weekly-summary %, runs "%" on "%"', v_result, v_job.command, v_job.schedule;
  END IF;

  IF (SELECT count(*) FROM cron.job) <> 3 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: % jobs, expected 3', (SELECT count(*) FROM cron.job);
  END IF;

  RAISE NOTICE 'TEST 5 PASSED: existing jobs keep their schedule, missing ones are created';
  RAISE NOTICE '=== ALL EDGE FUNCTION CALLER TESTS PASSED ===';
END $$;

ROLLBACK;
