-- ============================================================
-- 055_edge_function_callers.sql — only this project calls its functions
-- ============================================================
--
-- send-push, check-missed-habits, habit-reminders and weekly-summary run with
-- the gateway's JWT check off (config.toml), because the functions call each
-- other with a secret key, which is not a JWT. They were meant to check the
-- caller themselves, and did it by reading the token's `role` claim without
-- checking its signature — so a token written by hand passed, and anyone
-- could send a push to any user. The three cron functions also let in any
-- request with no key at all and a `pg_net/` User-Agent.
--
-- The functions now compare the caller's key with their own
-- (supabase/functions/_shared/internal-caller.ts). Two things here let the
-- database's calls keep working under that:
--
--   1. caller_is_service_role() — the vault may hold the project's legacy
--      service_role JWT, which is not one of a function's own keys. The
--      function then uses the presented key to call this, which only the
--      service role can run, so the API checks the signature for it.
--
--   2. invoke_edge_function() — cron's commands (015) had the key written
--      into them when they were registered: readable in cron.job, and stale
--      the day the key is rotated. Cron now calls this instead, which reads
--      the vault each time, as the notify triggers already do. Whichever
--      jobs were still running on no key at all get one too.
--
-- Apply this before deploying the functions: until it is in, they cannot
-- tell the vault's key from a forged one and turn the database away.

-- ── 1. A question only the service role can ask ──

CREATE OR REPLACE FUNCTION public.caller_is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(auth.role(), '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.caller_is_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caller_is_service_role() TO service_role;

-- ── 2. The database's one way to call a function ──

CREATE OR REPLACE FUNCTION public.invoke_edge_function(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'invoke_edge_function: not a function name: %', p_name;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'invoke_edge_function(%): the vault needs both supabase_url and service_role_key', p_name;
    RETURN;
  END IF;

  -- A secret key belongs on apikey; a legacy JWT on Authorization. The
  -- function reads either, so both are sent and the vault can hold either.
  PERFORM net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text) FROM PUBLIC, anon, authenticated;

-- ── 3. Pointing a cron job at it ──
--
-- A job that already exists keeps its schedule and whether it is switched
-- on; only what it runs changes. One that doesn't is created on p_schedule.

CREATE OR REPLACE FUNCTION public.schedule_edge_function(p_name text, p_schedule text)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_command text := format('SELECT public.invoke_edge_function(%L)', p_name);
  v_jobid bigint;
  v_found boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron is not installed (local dev): % is not scheduled', p_name;
    RETURN 'skipped';
  END IF;

  FOR v_jobid IN SELECT jobid FROM cron.job WHERE jobname = p_name LOOP
    PERFORM cron.alter_job(v_jobid, command := v_command);
    v_found := true;
  END LOOP;
  IF v_found THEN
    RETURN 'updated';
  END IF;

  PERFORM cron.schedule(p_name, p_schedule, v_command);
  RETURN 'created';
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_edge_function(text, text) FROM PUBLIC, anon, authenticated;

SELECT public.schedule_edge_function('check-missed-habits', '0 * * * *');
SELECT public.schedule_edge_function('weekly-summary', '0 * * * *');
SELECT public.schedule_edge_function('habit-reminders', '*/15 * * * *');
