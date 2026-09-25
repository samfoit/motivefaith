-- ============================================================
-- 031_partner_follow_copy.sql — one verb for the partner side
-- ============================================================
--
-- 030 worded these notifications with "watch": "X asked to watch Y", "X is now
-- watching Y". The UI has since settled on "follow" — clearer, and the pending
-- state maps onto a pattern people already know from following a private
-- account. A push that says one thing while the screen it opens says another
-- is the same split this feature already had once between "join" and "watch",
-- so the trigger is retitled to match.
--
-- Body reproduced from 030; only the four user-facing strings differ.

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
