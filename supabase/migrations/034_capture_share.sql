-- ============================================================
-- 034_capture_share.sql — one capture, many destinations
-- ============================================================
--
-- The camera button used to post a photo or video to exactly one habit. Now a
-- single capture can go to any mix of habits (one check-in each), friends (a
-- DM in encouragements) and groups (a row in group_messages).
--
-- The file is uploaded once, to the existing private `completions` bucket at
-- `{uid}/capture/{uuid}.{ext}`, and every destination row stores that path.
-- Who may read the file is decided by which rows reference it, not by the
-- path layout — the old habit-in-the-path rule cannot express "bob, because
-- alice DMed it to him".
--
-- A row only grants access to a file under its own author's folder. Without
-- that, anyone could write someone else's private path into a DM and hand
-- their friend a key to it.

-- ── 1. Media columns on DMs and group messages ──

ALTER TABLE public.encouragements
  ADD COLUMN media_path TEXT,
  ADD COLUMN media_type TEXT,
  ADD CONSTRAINT chk_encouragement_media_type
    CHECK (media_type IS NULL OR media_type IN ('photo', 'video')),
  ADD CONSTRAINT chk_encouragement_media_pair
    CHECK ((media_path IS NULL) = (media_type IS NULL));

CREATE INDEX idx_encouragements_media_path
  ON public.encouragements (media_path)
  WHERE media_path IS NOT NULL;

-- A group message may now be media with no text, but never neither.
ALTER TABLE public.group_messages
  ALTER COLUMN content DROP NOT NULL,
  ADD COLUMN media_path TEXT,
  ADD COLUMN media_type TEXT,
  ADD CONSTRAINT chk_group_message_media_type
    CHECK (media_type IS NULL OR media_type IN ('photo', 'video')),
  ADD CONSTRAINT chk_group_message_media_pair
    CHECK ((media_path IS NULL) = (media_type IS NULL)),
  ADD CONSTRAINT chk_group_message_has_body
    CHECK (char_length(coalesce(content, '')) > 0 OR media_path IS NOT NULL);

CREATE INDEX idx_group_messages_media_path
  ON public.group_messages (media_path)
  WHERE media_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_completions_evidence_url
  ON public.completions (evidence_url)
  WHERE evidence_url IS NOT NULL;

-- ── 2. Who may read a shared capture ──

CREATE OR REPLACE FUNCTION public.can_read_capture_media(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM encouragements e
    WHERE e.media_path = p_path
      AND e.recipient_id = auth.uid()
      AND e.user_id::text = split_part(p_path, '/', 1)
  )
  OR EXISTS (
    SELECT 1 FROM group_messages gm
    WHERE gm.media_path = p_path
      AND gm.user_id::text = split_part(p_path, '/', 1)
      AND is_group_member(gm.group_id)
  )
  OR EXISTS (
    SELECT 1 FROM completions c
    WHERE c.evidence_url = p_path
      AND c.user_id::text = split_part(p_path, '/', 1)
      AND is_accepted_partner(c.habit_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_capture_media(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_capture_media(TEXT) TO authenticated;

-- The owner and habit-partner clauses are 029's, unchanged.
DROP POLICY IF EXISTS "Users read own or shared completions" ON storage.objects;

CREATE POLICY "Users read own or shared completions"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'completions'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.habit_shares hs
        WHERE hs.shared_with = auth.uid()
          AND hs.status = 'accepted'
          AND hs.habit_id::text = (storage.foldername(name))[2]
      )
      OR public.can_read_capture_media(name)
    )
  );

-- ── 3. share_capture: every destination in one transaction ──
--
-- All or nothing, so a send never lands on the habit but not the DM. Each
-- habit goes through insert_completion, keeping its ownership check and rate
-- limit in one place. Friend and group checks mirror the insert policies on
-- encouragements and group_messages; their rate-limit and notify triggers
-- still fire on each row.

CREATE OR REPLACE FUNCTION public.share_capture(
  p_media_path TEXT,
  p_media_type TEXT,
  p_caption TEXT DEFAULT NULL,
  p_habit_ids UUID[] DEFAULT '{}',
  p_friend_ids UUID[] DEFAULT '{}',
  p_group_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caption TEXT := nullif(btrim(coalesce(p_caption, '')), '');
  v_id UUID;
  v_completion completions;
  v_completion_ids UUID[] := '{}';
  v_encouragement_ids UUID[] := '{}';
  v_group_message_ids UUID[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF coalesce(cardinality(p_habit_ids), 0)
     + coalesce(cardinality(p_friend_ids), 0)
     + coalesce(cardinality(p_group_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Pick at least one destination' USING ERRCODE = '22023';
  END IF;

  IF p_media_type IS NULL OR p_media_type NOT IN ('photo', 'video') THEN
    RAISE EXCEPTION 'Unsupported media type' USING ERRCODE = '22023';
  END IF;

  IF p_media_path IS NULL OR split_part(p_media_path, '/', 1) != v_uid::text THEN
    RAISE EXCEPTION 'Media must be your own upload' USING ERRCODE = '42501';
  END IF;

  IF v_caption IS NOT NULL AND char_length(v_caption) > 5000 THEN
    RAISE EXCEPTION 'Caption too long' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_habit_ids, '{}') LOOP
    v_completion := insert_completion(
      v_id, p_media_type::completion_type, p_media_path, v_caption
    );
    v_completion_ids := v_completion_ids || v_completion.id;
  END LOOP;

  FOREACH v_id IN ARRAY coalesce(p_friend_ids, '{}') LOOP
    IF v_id = v_uid OR NOT are_friends(v_uid, v_id) THEN
      RAISE EXCEPTION 'Not friends with recipient' USING ERRCODE = '42501';
    END IF;

    INSERT INTO encouragements (
      user_id, recipient_id, encouragement_type, content, media_path, media_type
    )
    VALUES (v_uid, v_id, 'message', v_caption, p_media_path, p_media_type)
    RETURNING id INTO v_id;

    v_encouragement_ids := v_encouragement_ids || v_id;
  END LOOP;

  FOREACH v_id IN ARRAY coalesce(p_group_ids, '{}') LOOP
    IF NOT is_group_member(v_id) THEN
      RAISE EXCEPTION 'Not a member of that group' USING ERRCODE = '42501';
    END IF;

    INSERT INTO group_messages (group_id, user_id, content, media_path, media_type)
    VALUES (v_id, v_uid, v_caption, p_media_path, p_media_type)
    RETURNING id INTO v_id;

    v_group_message_ids := v_group_message_ids || v_id;
  END LOOP;

  RETURN jsonb_build_object(
    'completion_ids', to_jsonb(v_completion_ids),
    'encouragement_ids', to_jsonb(v_encouragement_ids),
    'group_message_ids', to_jsonb(v_group_message_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.share_capture(TEXT, TEXT, TEXT, UUID[], UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.share_capture(TEXT, TEXT, TEXT, UUID[], UUID[], UUID[]) TO authenticated;

-- ── 4. The DM thread returns the media too ──
--
-- get_friend_journey's body from 029, with media_path and media_type added to
-- the encouragements it returns. Nothing else changes.

CREATE OR REPLACE FUNCTION get_friend_journey(p_user_id UUID, p_friend_id UUID)
RETURNS TABLE (
  habits          JSONB,
  completions     JSONB,
  encouragements  JSONB,
  user_timezone   TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s journey data';
  END IF;

  RETURN QUERY
  WITH shared AS (
    -- Direction A: my habits this friend has accepted a partnership on
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_user_id
    WHERE hs.shared_with = p_friend_id
      AND hs.status = 'accepted'
    UNION
    -- Direction B: their habits I have accepted a partnership on
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_friend_id
    WHERE hs.shared_with = p_user_id
      AND hs.status = 'accepted'
  ),
  habit_details AS (
    SELECT
      h.id,
      h.title,
      coalesce(h.emoji, '✅') AS emoji,
      coalesce(h.color, '#6366F1') AS color,
      h.user_id AS owner_id,
      coalesce(h.streak_current, 0) AS streak_current,
      coalesce(h.streak_best, 0) AS streak_best,
      (h.user_id = p_user_id) AS is_owner
    FROM shared s
    JOIN habits h ON h.id = s.habit_id
  ),
  viewer_tz AS (
    SELECT coalesce(p.timezone, 'UTC') AS tz
    FROM profiles p
    WHERE p.id = p_user_id
  ),
  today_local AS (
    SELECT (now() AT TIME ZONE (SELECT tz FROM viewer_tz))::date AS d
  ),
  completions_30d AS (
    SELECT
      c.id,
      c.habit_id,
      c.user_id,
      c.completion_type,
      c.rain_check_reason,
      c.rain_check_moved_to,
      c.evidence_url,
      c.notes,
      c.completed_at,
      c.completed_date
    FROM completions c
    WHERE c.habit_id IN (SELECT hd.id FROM habit_details hd)
      AND c.user_id IN (p_user_id, p_friend_id)
      AND c.completed_at > now() - interval '30 days'
    ORDER BY c.completed_at DESC
    LIMIT 500
  ),
  enc AS (
    SELECT
      e.id,
      e.user_id,
      e.encouragement_type,
      e.content,
      e.media_path,
      e.media_type,
      e.created_at,
      e.completion_id
    FROM encouragements e
    WHERE (
      (e.user_id = p_user_id AND e.recipient_id = p_friend_id)
      OR (e.user_id = p_friend_id AND e.recipient_id = p_user_id)
    )
    ORDER BY e.created_at DESC
    LIMIT 30
  )
  SELECT
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', hd.id,
        'title', hd.title,
        'emoji', hd.emoji,
        'color', hd.color,
        'owner_id', hd.owner_id,
        'streak_current', hd.streak_current,
        'streak_best', hd.streak_best,
        'is_owner', hd.is_owner,
        'completed_today', EXISTS (
          SELECT 1 FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type IS DISTINCT FROM 'rain_check'
        ),
        'rain_checked_today', EXISTS (
          SELECT 1 FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type = 'rain_check'
        ),
        'rain_check_moved_to', (
          SELECT c2.rain_check_moved_to FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type = 'rain_check'
          LIMIT 1
        )
      ) ORDER BY hd.title) FROM habit_details hd),
      '[]'::jsonb
    ),

    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'habit_id', c.habit_id,
        'user_id', c.user_id,
        'completion_type', coalesce(c.completion_type, 'quick'),
        'rain_check_reason', c.rain_check_reason,
        'rain_check_moved_to', c.rain_check_moved_to,
        'evidence_url', c.evidence_url,
        'notes', c.notes,
        'completed_at', c.completed_at,
        'habit_emoji', hd.emoji,
        'habit_title', hd.title,
        'habit_color', hd.color
      ) ORDER BY c.completed_at DESC)
      FROM completions_30d c
      JOIN habit_details hd ON hd.id = c.habit_id),
      '[]'::jsonb
    ),

    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'user_id', e.user_id,
        'encouragement_type', coalesce(e.encouragement_type, 'nudge'),
        'content', e.content,
        'media_path', e.media_path,
        'media_type', e.media_type,
        'created_at', e.created_at,
        'completion_id', e.completion_id
      ) ORDER BY e.created_at DESC)
      FROM enc e),
      '[]'::jsonb
    ),

    (SELECT tz FROM viewer_tz);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_friend_journey(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_friend_journey(UUID, UUID) TO authenticated;

-- ── 5. Push text for a message that is only a photo or video ──
--
-- Both bodies are 010's, except for the fallback when there is no caption.

CREATE OR REPLACE FUNCTION public.message_push_body(
  p_content TEXT,
  p_media_type TEXT,
  p_fallback TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_content IS NOT NULL AND length(p_content) > 0 THEN left(p_content, 200)
    WHEN p_media_type = 'photo' THEN '📷 Sent a photo'
    WHEN p_media_type = 'video' THEN '🎥 Sent a video'
    ELSE p_fallback
  END;
$$;

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

  v_body := message_push_body(NEW.content, NEW.media_type, 'Tap to view');

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


-- ── 6. Today's habits, as the dashboard card needs them ──
--
-- The "Send to…" list draws habits with the dashboard's card. Body from 027
-- with two changes:
--
--   frequency  the streak pill is spoken as "3-day" or "3-week" streak, and
--              without it a weekly habit read as days.
--   color,     returned as stored. The old defaults (indigo, ✅) were
--   emoji      harmless in a plain list, but the card tints itself with the
--              color, so every uncolored habit turned purple — and the two
--              screens disagreed about what a habit looks like.
--
-- A new column changes the return type, which CREATE OR REPLACE cannot do.

DROP FUNCTION IF EXISTS get_incomplete_habits_today(TEXT);

CREATE OR REPLACE FUNCTION get_incomplete_habits_today(p_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  color TEXT,
  streak_current INTEGER,
  frequency habit_frequency
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_dow INT;
  v_today_date DATE;
BEGIN
  v_today_dow := EXTRACT(DOW FROM now() AT TIME ZONE p_timezone)::int;
  v_today_date := (now() AT TIME ZONE p_timezone)::date;

  RETURN QUERY
  SELECT
    h.id,
    h.title,
    -- Both as stored: the dashboard shows no emoji and no tint for a
    -- habit without one, and this list must match it.
    h.emoji,
    h.color,
    coalesce(h.streak_current, 0) AS streak_current,
    h.frequency
  FROM habits h
  WHERE h.user_id = auth.uid()
    AND h.is_paused = false
    AND (
      (h.schedule->'days') @> to_jsonb(v_today_dow)
      -- …or an earlier rain check promised to make it up today.
      OR EXISTS (
        SELECT 1 FROM completions rc
        WHERE rc.habit_id = h.id
          AND rc.completion_type = 'rain_check'
          AND rc.rain_check_moved_to = v_today_date
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = v_today_date
    )
  ORDER BY h.created_at;
END;
$$;

REVOKE ALL ON FUNCTION get_incomplete_habits_today(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incomplete_habits_today(TEXT) TO authenticated;
