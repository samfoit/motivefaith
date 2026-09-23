-- ============================================================
-- 030_partner_notifications.sql — push for the partnership handshake
-- ============================================================
--
-- 029 made accountability partnership a two-sided handshake but left it
-- silent: an invitation landed in a pending row that the other person would
-- only discover by opening the app and looking. That is the wrong default for
-- the one thing in the inbox that is genuinely waiting on them.
--
-- Three moments are worth a push:
--
--   invited    someone wants you watching their habit
--   requested  a friend wants to watch yours
--   accepted   the person you asked said yes
--
-- A decline is deliberately silent. "No" is a complete answer, and pushing it
-- makes the refusal louder than the request was — the row simply stops
-- appearing, and the person who asked can see that for themselves. It is also
-- the difference between a product that lets people say no and one that
-- punishes them for it.

-- ── 1. The preference key ──
--
-- update_own_notification_prefs rebuilds the whole object from a whitelist and
-- drops anything it does not name, so a key that is not added here is silently
-- lost the next time the user touches any other setting. Body otherwise
-- unchanged from 010_notifications.sql.

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
    'partner_alerts',       coalesce((p_prefs->'partner_alerts')::boolean,       true),
    'enabled',              coalesce((p_prefs->'enabled')::boolean,              true)
  );

  UPDATE profiles
  SET notification_prefs = v_safe
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION update_own_notification_prefs(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_own_notification_prefs(JSONB) TO authenticated;

-- A profile that predates this key has no 'partner_alerts' at all. Every gate
-- below tests `IS DISTINCT FROM 'false'`, so an absent key reads as on — the
-- same convention habit_reminders and encouragement_alerts already rely on.
-- Nothing is backfilled.

-- ── 2. The trigger ──

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
      v_title := v_habit_emoji || ' ' || v_actor_name || ' asked to watch ' || v_habit_title;
    ELSE
      v_title := v_habit_emoji || ' ' || v_actor_name || ' invited you to watch ' || v_habit_title;
    END IF;
  ELSE
    IF v_recipient_id = v_owner_id THEN
      -- You invited them; they accepted. Your habit, so go to it.
      v_title := v_habit_emoji || ' ' || v_actor_name || ' is now watching ' || v_habit_title;
      v_body  := 'They will see your check-ins from now on';
      v_url   := '/main/habits/' || NEW.habit_id;
    ELSE
      -- You asked to watch theirs; they said yes. Their page, not yours.
      v_title := v_habit_emoji || ' ' || v_actor_name || ' accepted — you can see ' || v_habit_title;
      v_body  := 'Tap to see how it is going';
      v_url   := '/main/feed/' || v_owner_id;
    END IF;
  END IF;

  SELECT push_subscription, notification_prefs, timezone
  INTO v_recipient FROM profiles WHERE id = v_recipient_id;

  IF v_recipient.push_subscription IS NULL THEN RETURN NEW; END IF;
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
      'subscription', v_recipient.push_subscription,
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

DROP TRIGGER IF EXISTS trg_notify_habit_partner ON public.habit_shares;

-- INSERT *and* UPDATE: the handshake moves through this table both ways, and
-- a re-invitation after a decline is an update.
CREATE TRIGGER trg_notify_habit_partner
  AFTER INSERT OR UPDATE ON public.habit_shares
  FOR EACH ROW
  EXECUTE FUNCTION notify_habit_partner();
