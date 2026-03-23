-- ============================================================
-- 007_cron.sql — pg_cron scheduling (hosted Supabase only)
-- ============================================================

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

  -- Hourly missed habits check
  PERFORM cron.schedule(
    'check-missed-habits',
    '0 * * * *',
    format(
      'SELECT net.http_post(url := %L || %L, headers := jsonb_build_object(%L, %L || current_setting(%L), %L, %L), body := %L::jsonb)',
      current_setting('app.settings.supabase_url'),
      '/functions/v1/check-missed-habits',
      'Authorization', 'Bearer ', 'app.settings.service_role_key',
      'Content-Type', 'application/json',
      '{}'
    )
  );

  -- Hourly streak reset (offset by 30 min from missed-habits check)
  PERFORM cron.schedule(
    'reset-stale-streaks',
    '30 * * * *',
    'SELECT reset_stale_streaks()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net not available (local dev) — skipping cron schedules: %', SQLERRM;
END $$;
