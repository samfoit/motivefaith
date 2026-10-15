-- ============================================================
-- 036_push_subscriptions.sql — one push subscription per device
-- ============================================================
--
-- profiles.push_subscription held a single subscription, and every device
-- that opened the profile page re-saved its own over it. Whichever device was
-- opened last received every notification; the rest went silent while still
-- reporting "Notifications On".
--
-- Subscriptions now live one row per device, keyed by endpoint. Senders name a
-- recipient by user_id only and send-push fans out to all of that user's
-- devices, dropping any the push service reports gone (404/410).
--
-- profiles.push_subscription is left in place but no longer read or written,
-- so a client still running the previous build fails soft until it updates.
-- Drop it in a later migration.

-- ── 1. The table ──

CREATE TABLE public.push_subscriptions (
  -- The endpoint identifies one browser on one device. Keying on it means a
  -- device that signs into another account moves to that account rather than
  -- delivering the previous user's notifications.
  endpoint   TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions (user_id);

-- No policies: clients go through the RPCs below, senders run as service_role
-- or SECURITY DEFINER.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ── 2. Carry over existing subscriptions ──

INSERT INTO public.push_subscriptions (endpoint, user_id, p256dh, auth)
SELECT push_subscription->>'endpoint',
       id,
       push_subscription->'keys'->>'p256dh',
       push_subscription->'keys'->>'auth'
FROM public.profiles
WHERE push_subscription->>'endpoint' IS NOT NULL
  AND push_subscription->'keys'->>'p256dh' IS NOT NULL
  AND push_subscription->'keys'->>'auth' IS NOT NULL
ON CONFLICT (endpoint) DO NOTHING;

-- ── 3. Client RPCs ──

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint NOT LIKE 'https://%' OR length(p_endpoint) > 2048 THEN
    RAISE EXCEPTION 'Invalid push endpoint';
  END IF;
  IF coalesce(length(p_p256dh), 0) NOT BETWEEN 1 AND 256
     OR coalesce(length(p_auth), 0) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'Invalid push keys';
  END IF;

  INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
  VALUES (p_endpoint, auth.uid(), p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        updated_at = now();

  -- Every send fans out to each row, so cap how many devices one user can
  -- accumulate. Browsers that silently dropped their subscription are the
  -- least recently saved, so those go first.
  DELETE FROM push_subscriptions
  WHERE user_id = auth.uid()
    AND endpoint NOT IN (
      SELECT endpoint FROM push_subscriptions
      WHERE user_id = auth.uid()
      ORDER BY updated_at DESC
      LIMIT 10
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM push_subscriptions
  WHERE endpoint = p_endpoint AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.delete_push_subscription(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(TEXT) TO authenticated;

-- ── 4. Reminder RPC: filter on having any device ──
--
-- The return type loses push_subscription, so it is dropped and recreated.
-- Body otherwise from 010_notifications.sql.

DROP FUNCTION IF EXISTS get_habits_due_for_reminder(TIMESTAMPTZ);

CREATE FUNCTION get_habits_due_for_reminder(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  user_id UUID,
  notification_prefs JSONB,
  timezone TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT h.id, h.title, h.emoji, h.user_id,
         p.notification_prefs, p.timezone
  FROM public.habits h
  JOIN public.profiles p ON p.id = h.user_id
  WHERE h.is_paused = false
    AND h.time_window IS NOT NULL
    AND (h.time_window->>'start') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.id)
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

-- Only the habit-reminders edge function calls this. Left at the default
-- grant, any client could read every user's due habits and prefs (and, before
-- this migration, their push subscriptions).
REVOKE ALL ON FUNCTION get_habits_due_for_reminder(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_habits_due_for_reminder(TIMESTAMPTZ) TO service_role;

-- ── 5. Triggers: name the recipient, not a subscription ──
--
-- Bodies from their latest definitions; the only changes are the
-- push_subscription filter becoming an EXISTS on push_subscriptions and the
-- payload dropping 'subscription'.

-- notify_completion (body from 029_habit_visibility.sql)

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
  v_is_rain_check BOOLEAN;
  v_title TEXT;
  v_body TEXT;
  v_type TEXT;
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

  v_is_rain_check := NEW.completion_type = 'rain_check';

  IF v_is_rain_check THEN
    IF NEW.rain_check_moved_to IS NOT NULL THEN
      v_title := '🌧 ' || v_habit.display_name || ' moved ' || v_habit.title
                 || ' to ' || trim(to_char(NEW.rain_check_moved_to, 'FMDay'));
    ELSE
      v_title := '🌧 ' || v_habit.display_name || ' took a rain check on ' || v_habit.title;
    END IF;
    -- Prefer the user's own words; fall back to the chosen reason.
    v_body  := coalesce(
                 nullif(left(NEW.notes, 200), ''),
                 rain_check_reason_label(NEW.rain_check_reason)
               );
    v_type  := 'rain_check';
  ELSE
    v_title := v_habit.emoji || ' ' || v_habit.display_name || ' completed ' || v_habit.title;
    v_body  := 'Tap to see their progress!';
    v_type  := 'completion';
  END IF;

  FOR v_share IN
    SELECT hs.shared_with, p.notification_prefs, p.timezone
    FROM habit_shares hs
    JOIN profiles p ON p.id = hs.shared_with
    WHERE hs.habit_id = NEW.habit_id
      AND hs.status = 'accepted'
      AND hs.notify_complete = true
      AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = p.id)
      AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
      AND (p.notification_prefs->>'completion_alerts') IS DISTINCT FROM 'false'
  LOOP
    IF is_in_quiet_hours(v_share.notification_prefs, v_share.timezone) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'url', '/main/feed/' || NEW.user_id,
      'type', v_type,
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

-- notify_encouragement (body from 034_capture_share.sql)

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

  SELECT notification_prefs, timezone
  INTO v_recipient FROM profiles WHERE id = NEW.recipient_id;

  IF NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = NEW.recipient_id) THEN RETURN NEW; END IF;
  IF (v_recipient.notification_prefs->>'enabled') = 'false' THEN RETURN NEW; END IF;
  IF (v_recipient.notification_prefs->>'encouragement_alerts') = 'false' THEN RETURN NEW; END IF;
  IF is_in_quiet_hours(v_recipient.notification_prefs, v_recipient.timezone) THEN RETURN NEW; END IF;

  v_body := message_push_body(NEW.content, NEW.media_type, 'Tap to view');

  v_payload := jsonb_build_object(
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

-- notify_group_message (body from 034_capture_share.sql)

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
    SELECT gm.user_id, p.notification_prefs, p.timezone,
           gm.notification_prefs AS gm_prefs
    FROM group_members gm
    JOIN profiles p ON p.id = gm.user_id
    WHERE gm.group_id = NEW.group_id
      AND gm.user_id != NEW.user_id
      AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = p.id)
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
      'title', v_sender_name || ' in ' || v_group_name,
      'body', message_push_body(NEW.content, NEW.media_type, ''),
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

-- notify_habit_partner (body from 031_partner_follow_copy.sql)

CREATE OR REPLACE FUNCTION notify_habit_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id     UUID;
  v_habit_title  TEXT;
  v_habit_emoji  TEXT;
  v_recipient_id UUID;
  v_actor_id     UUID;
  v_actor_name   TEXT;
  v_recipient    RECORD;
  v_title        TEXT;
  v_body         TEXT;
  v_type         TEXT;
  v_url          TEXT;
  v_supabase_url TEXT;
  v_service_key  TEXT;
BEGIN
  -- A partnership must still be made when push is not configured, so every
  -- failure path below returns NEW rather than raising.
  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key  FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN RETURN NEW; END IF;

  -- An orphaned initiator (the column is ON DELETE SET NULL) leaves nobody to
  -- name and nobody to tell.
  IF NEW.initiated_by IS NULL THEN RETURN NEW; END IF;

  SELECT h.user_id, h.title, coalesce(h.emoji, '✅')
  INTO v_owner_id, v_habit_title, v_habit_emoji
  FROM habits h WHERE h.id = NEW.habit_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    -- A new ask. Whoever did not start it is the one who has to answer, and
    -- so the one who needs telling. The OLD.status clause is what makes a
    -- re-invitation after a decline notify too — that path is an UPDATE back
    -- to pending, not an insert.
    v_actor_id     := NEW.initiated_by;
    v_recipient_id := CASE WHEN NEW.initiated_by = v_owner_id
                           THEN NEW.shared_with ELSE v_owner_id END;
    v_type := 'partner_request';
    v_url  := '/main/inbox';
    v_body := 'Tap to accept or decline';

  ELSIF NEW.status = 'accepted'
        AND TG_OP = 'UPDATE' AND OLD.status = 'pending' THEN
    -- Answered yes. The person who asked hears about it; the one who just
    -- tapped Accept does not need telling what they did.
    v_recipient_id := NEW.initiated_by;
    v_actor_id     := CASE WHEN NEW.initiated_by = v_owner_id
                           THEN NEW.shared_with ELSE v_owner_id END;
    v_type := 'partner_accepted';

  ELSE
    RETURN NEW;
  END IF;

  -- Nothing to say to yourself.
  IF v_recipient_id IS NULL OR v_recipient_id = v_actor_id THEN RETURN NEW; END IF;

  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;
  IF v_actor_name IS NULL THEN RETURN NEW; END IF;

  -- Wording depends on which side of the habit the recipient sits on, which
  -- also decides where tapping should land them.
  IF v_type = 'partner_request' THEN
    IF v_recipient_id = v_owner_id THEN
      v_title := v_habit_emoji || ' ' || v_actor_name || ' asked to follow ' || v_habit_title;
    ELSE
      v_title := v_habit_emoji || ' ' || v_actor_name || ' invited you to follow ' || v_habit_title;
    END IF;
  ELSE
    IF v_recipient_id = v_owner_id THEN
      -- You invited them; they accepted. Your habit, so go to it.
      v_title := v_habit_emoji || ' ' || v_actor_name || ' is now following ' || v_habit_title;
      v_body  := 'They will see your check-ins from now on';
      v_url   := '/main/habits/' || NEW.habit_id;
    ELSE
      -- You asked to watch theirs; they said yes. Their page, not yours.
      v_title := v_habit_emoji || ' ' || v_actor_name || ' accepted — you now follow ' || v_habit_title;
      v_body  := 'Tap to see how it is going';
      v_url   := '/main/feed/' || v_owner_id;
    END IF;
  END IF;

  SELECT notification_prefs, timezone
  INTO v_recipient FROM profiles WHERE id = v_recipient_id;

  IF NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = v_recipient_id) THEN RETURN NEW; END IF;
  IF (v_recipient.notification_prefs->>'enabled')        IS NOT DISTINCT FROM 'false' THEN RETURN NEW; END IF;
  IF (v_recipient.notification_prefs->>'partner_alerts') IS NOT DISTINCT FROM 'false' THEN RETURN NEW; END IF;
  IF is_in_quiet_hours(v_recipient.notification_prefs, v_recipient.timezone) THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'title', v_title,
      'body',  v_body,
      'url',   v_url,
      'type',  v_type,
      'user_id', v_recipient_id
    )
  );

  RETURN NEW;
END;
$$;
