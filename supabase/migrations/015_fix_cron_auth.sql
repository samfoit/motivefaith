-- ============================================================
-- 015_fix_cron_auth.sql — Re-register all cron jobs with vault secrets
--
-- 007_cron.sql used current_setting('app.settings.service_role_key')
-- which is NOT available in pg_cron's background worker context
-- (that GUC is set by PostgREST per-connection, not database-wide).
-- This migration re-registers all cron jobs using vault secrets,
-- consistent with how the database triggers already work.
-- ============================================================

DO $$
DECLARE
  v_supabase_url TEXT;
  v_service_key  TEXT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'Vault secrets not configured — skipping cron re-registration';
    RETURN;
  END IF;

  -- ── Re-register check-missed-habits (fixes broken current_setting auth) ──
  PERFORM cron.schedule(
    'check-missed-habits',
    '0 * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
      v_supabase_url || '/functions/v1/check-missed-habits',
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      '{}'
    )
  );

  -- ── Re-register reset-stale-streaks (no change needed, but ensure it exists) ──
  PERFORM cron.schedule(
    'reset-stale-streaks',
    '30 * * * *',
    'SELECT reset_stale_streaks()'
  );

  -- ── Re-register weekly-summary ──
  PERFORM cron.schedule(
    'weekly-summary',
    '0 * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
      v_supabase_url || '/functions/v1/weekly-summary',
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      '{}'
    )
  );

  -- ── Re-register habit-reminders ──
  PERFORM cron.schedule(
    'habit-reminders',
    '*/15 * * * *',
    format(
      'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
      v_supabase_url || '/functions/v1/habit-reminders',
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      '{}'
    )
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net not available (local dev) — skipping cron re-registration: %', SQLERRM;
END $$;
