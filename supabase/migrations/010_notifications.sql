-- ============================================================
-- 010_notifications.sql — push notification triggers & cron
-- ============================================================

-- ── Schema changes ──

ALTER TABLE public.habits ADD COLUMN IF NOT EXISTS last_reminder_date DATE;

CREATE INDEX IF NOT EXISTS idx_habits_time_window
  ON public.habits (user_id)
  WHERE time_window IS NOT NULL AND is_paused = false;

-- ── Update notification preferences RPC ──

CREATE OR REPLACE FUNCTION update_own_notification_prefs(p_prefs JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safe JSONB;
BEGIN
  -- Only allow known keys with validated types to prevent arbitrary JSON injection
  v_safe := jsonb_build_object(
    'quiet_start', CASE WHEN (p_prefs->>'quiet_start') ~ '^\d{2}:\d{2}$' THEN p_prefs->>'quiet_start' ELSE '22:00' END,
    'quiet_end',   CASE WHEN (p_prefs->>'quiet_end')   ~ '^\d{2}:\d{2}$' THEN p_prefs->>'quiet_end'   ELSE '07:00' END,
    'completion_alerts',    coalesce((p_prefs->'completion_alerts')::boolean,    true),
    'miss_alerts',          coalesce((p_prefs->'miss_alerts')::boolean,          true),
    'habit_reminders',      coalesce((p_prefs->'habit_reminders')::boolean,      true),
    'encouragement_alerts', coalesce((p_prefs->'encouragement_alerts')::boolean, true),
    'enabled',              coalesce((p_prefs->'enabled')::boolean,              true)
  );

  UPDATE profiles
  SET notification_prefs = v_safe
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION update_own_notification_prefs(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_own_notification_prefs(JSONB) TO authenticated;

-- ── Quiet hours helper (reusable by all triggers) ──

CREATE OR REPLACE FUNCTION is_in_quiet_hours(
  prefs JSONB,
  tz TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_start TEXT;
  v_end TEXT;
  v_now TEXT;
BEGIN
  v_start := prefs->>'quiet_start';
  v_end := prefs->>'quiet_end';
  IF v_start IS NULL OR v_end IS NULL THEN
    RETURN false;
  END IF;

  v_now := to_char(now() AT TIME ZONE coalesce(tz, 'UTC'), 'HH24:MI');

  -- Handle overnight quiet hours (e.g. 22:00 - 07:00)
  IF v_start > v_end THEN
    RETURN v_now >= v_start OR v_now < v_end;
  END IF;

  RETURN v_now >= v_start AND v_now < v_end;
END;
$$;

-- ── Completion notification trigger ──

CREATE OR REPLACE FUNCTION notify_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_habit RECORD;
  v_share RECORD;
  v_payload JSONB;
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT h.title, h.emoji, p.display_name
  INTO v_habit
  FROM habits h JOIN profiles p ON p.id = h.user_id
  WHERE h.id = NEW.habit_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  FOR v_share IN
    SELECT hs.shared_with, p.push_subscription, p.notification_prefs, p.timezone
    FROM habit_shares hs
    JOIN profiles p ON p.id = hs.shared_with
    WHERE hs.habit_id = NEW.habit_id
      AND hs.notify_complete = true
      AND p.push_subscription IS NOT NULL
      AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
      AND (p.notification_prefs->>'completion_alerts') IS DISTINCT FROM 'false'
  LOOP
    IF is_in_quiet_hours(v_share.notification_prefs, v_share.timezone) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'subscription', v_share.push_subscription,
      'title', v_habit.emoji || ' ' || v_habit.display_name || ' completed ' || v_habit.title,
      'body', 'Tap to see their progress!',
      'url', '/main/feed/' || NEW.user_id,
      'type', 'completion',
      'user_id', v_share.shared_with
    );

    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_completion
  AFTER INSERT ON completions
  FOR EACH ROW
  EXECUTE FUNCTION notify_completion();

-- ── Encouragement notification trigger ──

CREATE OR REPLACE FUNCTION notify_encouragement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name TEXT;
  v_recipient RECORD;
  v_body TEXT;
  v_payload JSONB;
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO v_sender_name FROM profiles WHERE id = NEW.user_id;

  SELECT push_subscription, notification_prefs, timezone
  INTO v_recipient FROM profiles WHERE id = NEW.recipient_id;

  IF v_recipient.push_subscription IS NULL THEN RETURN NEW; END IF;
  IF (v_recipient.notification_prefs->>'enabled') = 'false' THEN RETURN NEW; END IF;
  IF (v_recipient.notification_prefs->>'encouragement_alerts') = 'false' THEN RETURN NEW; END IF;
  IF is_in_quiet_hours(v_recipient.notification_prefs, v_recipient.timezone) THEN RETURN NEW; END IF;

  v_body := CASE
    WHEN NEW.content IS NOT NULL AND length(NEW.content) > 0
    THEN left(NEW.content, 200)
    ELSE 'Tap to view'
  END;

  v_payload := jsonb_build_object(
    'subscription', v_recipient.push_subscription,
    'title', v_sender_name,
    'body', v_body,
    'url', '/main/feed/' || NEW.user_id,
    'type', 'encouragement',
    'user_id', NEW.recipient_id
  );

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json'
    ),
    body := v_payload
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_encouragement
  AFTER INSERT ON encouragements
  FOR EACH ROW
  EXECUTE FUNCTION notify_encouragement();

-- ── Group message notification trigger ──

CREATE OR REPLACE FUNCTION notify_group_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name TEXT;
  v_group_name TEXT;
  v_member RECORD;
  v_payload JSONB;
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO v_sender_name FROM profiles WHERE id = NEW.user_id;
  SELECT name INTO v_group_name FROM groups WHERE id = NEW.group_id;

  FOR v_member IN
    SELECT gm.user_id, p.push_subscription, p.notification_prefs, p.timezone,
           gm.notification_prefs AS gm_prefs
    FROM group_members gm
    JOIN profiles p ON p.id = gm.user_id
    WHERE gm.group_id = NEW.group_id
      AND gm.user_id != NEW.user_id
      AND p.push_subscription IS NOT NULL
      AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
      AND (gm.notification_prefs->>'notify_messages') IS DISTINCT FROM 'false'
      AND (
        gm.notification_prefs->>'mute_until' IS NULL
        OR (gm.notification_prefs->>'mute_until')::timestamptz < now()
      )
  LOOP
    IF is_in_quiet_hours(v_member.notification_prefs, v_member.timezone) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'subscription', v_member.push_subscription,
      'title', v_sender_name || ' in ' || v_group_name,
      'body', left(NEW.content, 200),
      'url', '/main/feed/group/' || NEW.group_id,
      'type', 'group_message',
      'user_id', v_member.user_id
    );

    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_group_message
  AFTER INSERT ON group_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_group_message();

-- ── Habit reminder RPC function ──

CREATE OR REPLACE FUNCTION get_habits_due_for_reminder(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  user_id UUID,
  push_subscription JSONB,
  notification_prefs JSONB,
  timezone TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT h.id, h.title, h.emoji, h.user_id,
         p.push_subscription, p.notification_prefs, p.timezone
  FROM public.habits h
  JOIN public.profiles p ON p.id = h.user_id
  WHERE h.is_paused = false
    AND h.time_window IS NOT NULL
    AND (h.time_window->>'start') IS NOT NULL
    AND p.push_subscription IS NOT NULL
    AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
    AND (p.notification_prefs->>'habit_reminders') IS DISTINCT FROM 'false'
    -- Scheduled for today in user's timezone
    AND (h.schedule->'days') @> to_jsonb(
      EXTRACT(DOW FROM check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::int
    )
    -- Start time is within the current 15-minute window in user's timezone.
    -- Cast both sides to TIME to handle the midnight boundary correctly
    -- (e.g. 23:50 + 15min wraps to 00:05, which breaks string comparison).
    AND (h.time_window->>'start')::time >= (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::time
    AND (
      -- Normal case: window doesn't cross midnight
      (  (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::time
       < (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC') + interval '15 minutes')::time
         AND (h.time_window->>'start')::time
           < (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC') + interval '15 minutes')::time
      )
      OR
      -- Midnight wrap: window end is smaller than window start
      (  (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::time
       > (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC') + interval '15 minutes')::time
         AND (
           (h.time_window->>'start')::time >= (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::time
           OR (h.time_window->>'start')::time < (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC') + interval '15 minutes')::time
         )
      )
    )
    -- Not already completed today
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::date
    )
    -- Not already reminded today (deduplication)
    AND (h.last_reminder_date IS NULL
      OR h.last_reminder_date < (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::date
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── Cron schedules ──

DO $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'Vault secrets not configured — skipping cron schedules';
    RETURN;
  END IF;

  -- Weekly summary — hourly; the function self-filters to Sunday 17:00-21:00
  PERFORM cron.schedule(
    'weekly-summary',
    '0 * * * *',
    format(
      'SELECT net.http_post(url := %L || %L, headers := jsonb_build_object(%L, %L, %L, %L), body := %L::jsonb)',
      v_supabase_url,
      '/functions/v1/weekly-summary',
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json',
      '{}'
    )
  );

  -- Habit reminders — every 15 minutes
  PERFORM cron.schedule(
    'habit-reminders',
    '*/15 * * * *',
    format(
      'SELECT net.http_post(url := %L || %L, headers := jsonb_build_object(%L, %L, %L, %L), body := %L::jsonb)',
      v_supabase_url,
      '/functions/v1/habit-reminders',
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json',
      '{}'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net not available (local dev) — skipping cron schedules: %', SQLERRM;
END $$;
