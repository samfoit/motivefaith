-- ============================================================
-- 035_capture_voice.sql — voice notes from the camera button
-- ============================================================
--
-- The capture flow gains a voice mode beside the camera. A voice note is
-- uploaded and shared exactly like a photo or video (034): the same bucket,
-- path and read rule, one row per destination. Only the type lists widen.
-- It is called 'voice' rather than 'audio' to match completion_type's
-- 'voice' (019), which is what a habit check-in from it is recorded as.
-- The bucket already accepts audio (019).

-- ── 1. DMs and group messages may carry a voice note ──

ALTER TABLE public.encouragements
  DROP CONSTRAINT chk_encouragement_media_type,
  ADD CONSTRAINT chk_encouragement_media_type
    CHECK (media_type IS NULL OR media_type IN ('photo', 'video', 'voice'));

ALTER TABLE public.group_messages
  DROP CONSTRAINT chk_group_message_media_type,
  ADD CONSTRAINT chk_group_message_media_type
    CHECK (media_type IS NULL OR media_type IN ('photo', 'video', 'voice'));

-- ── 2. share_capture accepts 'voice' ──
--
-- 034's body; only the media type check changes. A habit picked for a voice
-- note gets a 'voice' check-in.

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
  v_reached_friends UUID[] := '{}';
  v_reached_groups UUID[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF coalesce(cardinality(p_habit_ids), 0)
     + coalesce(cardinality(p_friend_ids), 0)
     + coalesce(cardinality(p_group_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Pick at least one destination' USING ERRCODE = '22023';
  END IF;

  IF p_media_type IS NULL OR p_media_type NOT IN ('photo', 'video', 'voice') THEN
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
    -- After insert_completion, which has checked the habit is the caller's.
    v_reached_friends := v_reached_friends || habit_partner_ids(v_id);
    v_reached_groups := v_reached_groups || habit_group_ids(v_id);
  END LOOP;

  FOREACH v_id IN ARRAY coalesce(p_friend_ids, '{}') LOOP
    CONTINUE WHEN v_id = ANY(v_reached_friends);
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
    CONTINUE WHEN v_id = ANY(v_reached_groups);
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

-- ── 3. Push text for an uncaptioned voice note ──

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
    WHEN p_media_type = 'voice' THEN '🎙️ Sent a voice message'
    ELSE p_fallback
  END;
$$;
