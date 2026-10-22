-- ============================================================
-- 039_private_checkins.sql — a check-in whose content only you see
-- ============================================================
--
-- A note, photo, video or voice clip can be kept for yourself: it shows in
-- your own habit history, while partners and groups see a plain check-in,
-- the same as a quick one, with nothing to say there is more behind it.
--
-- RLS is per row, not per column, and partners read whole completions rows
-- (029) — through the table, realtime, and every journey/timeline/feed RPC.
-- So the private part never touches completions: the row is an ordinary
-- 'quick' check-in with no evidence or notes, and the real content sits in
-- an owner-only side table.
--
-- Private media is uploaded under {uid}/private/. The storage SELECT policy
-- (034) lets a partner read {owner}/{habit_id}/… for a shared habit, or a
-- path a completion, DM or group message carries. 'private' is not a habit
-- id and no shared row carries the path, so only the owner's own-folder
-- clause reaches it.

-- ── 1. The habit's default ──

ALTER TABLE public.habits
  ADD COLUMN private_checkins BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Owner-only content ──

CREATE TABLE public.completion_private_content (
  completion_id UUID PRIMARY KEY REFERENCES public.completions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  completion_type completion_type NOT NULL,
  evidence_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_private_content_type
    CHECK (completion_type IN ('photo', 'video', 'voice', 'message')),
  CONSTRAINT chk_private_content_notes
    CHECK (notes IS NULL OR char_length(notes) <= 5000),
  CONSTRAINT chk_private_content_present
    CHECK (evidence_url IS NOT NULL OR notes IS NOT NULL)
);

CREATE INDEX idx_completion_private_content_user
  ON public.completion_private_content (user_id);

ALTER TABLE public.completion_private_content ENABLE ROW LEVEL SECURITY;

-- No INSERT or UPDATE policy: rows are written only by
-- insert_private_completion, which checks the path is the caller's own.
CREATE POLICY "Own private content select"
  ON public.completion_private_content FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Own private content delete"
  ON public.completion_private_content FOR DELETE
  USING (user_id = auth.uid());

-- ── 3. Recording one ──

CREATE OR REPLACE FUNCTION public.insert_private_completion(
  p_habit_id UUID,
  p_completion_type completion_type,
  p_evidence_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_notes TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_evidence TEXT := nullif(p_evidence_url, '');
  v_completion completions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_completion_type NOT IN ('photo', 'video', 'voice', 'message') THEN
    RAISE EXCEPTION 'Unsupported private check-in type' USING ERRCODE = '22023';
  END IF;

  IF v_evidence IS NULL AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Nothing to keep private' USING ERRCODE = '22023';
  END IF;

  -- Media outside {uid}/private/ could be readable by partners through the
  -- habit-folder clause, which would defeat the point.
  IF v_evidence IS NOT NULL
     AND (split_part(v_evidence, '/', 1) != v_uid::text
          OR split_part(v_evidence, '/', 2) != 'private') THEN
    RAISE EXCEPTION 'Private media must be in your private folder'
      USING ERRCODE = '42501';
  END IF;

  -- The shared row: rate limit, ownership check, streak and push all as for
  -- a quick check-in.
  v_completion := insert_completion(p_habit_id, 'quick');

  INSERT INTO completion_private_content (
    completion_id, user_id, completion_type, evidence_url, notes
  )
  VALUES (v_completion.id, v_uid, p_completion_type, v_evidence, v_notes);

  RETURN v_completion;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_private_completion(UUID, completion_type, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_private_completion(UUID, completion_type, TEXT, TEXT) TO authenticated;

-- ── 4. share_capture can keep it private ──
--
-- 035's body plus p_private. A private capture only logs habits: sending it
-- to a friend or a group would share it, so that is refused rather than
-- quietly dropped. A new parameter changes the signature, and leaving the
-- old one would make six-argument calls ambiguous.

DROP FUNCTION IF EXISTS public.share_capture(TEXT, TEXT, TEXT, UUID[], UUID[], UUID[]);

CREATE OR REPLACE FUNCTION public.share_capture(
  p_media_path TEXT,
  p_media_type TEXT,
  p_caption TEXT DEFAULT NULL,
  p_habit_ids UUID[] DEFAULT '{}',
  p_friend_ids UUID[] DEFAULT '{}',
  p_group_ids UUID[] DEFAULT '{}',
  p_private BOOLEAN DEFAULT false
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

  IF coalesce(p_private, false)
     AND coalesce(cardinality(p_friend_ids), 0)
         + coalesce(cardinality(p_group_ids), 0) > 0 THEN
    RAISE EXCEPTION 'A private capture can only go to your habits'
      USING ERRCODE = '22023';
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
    IF coalesce(p_private, false) THEN
      v_completion := insert_private_completion(
        v_id, p_media_type::completion_type, p_media_path, v_caption
      );
    ELSE
      v_completion := insert_completion(
        v_id, p_media_type::completion_type, p_media_path, v_caption
      );
    END IF;
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

REVOKE ALL ON FUNCTION public.share_capture(TEXT, TEXT, TEXT, UUID[], UUID[], UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.share_capture(TEXT, TEXT, TEXT, UUID[], UUID[], UUID[], BOOLEAN) TO authenticated;

-- ── 5. Today's habits carry the default ──
--
-- 034's body plus private_checkins, so the capture flow can start its lock
-- where the picked habits want it. A new column changes the return type.

DROP FUNCTION IF EXISTS get_incomplete_habits_today(TEXT);

CREATE OR REPLACE FUNCTION get_incomplete_habits_today(p_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  color TEXT,
  streak_current INTEGER,
  frequency habit_frequency,
  partner_ids UUID[],
  group_ids UUID[],
  private_checkins BOOLEAN
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
    h.frequency,
    habit_partner_ids(h.id),
    habit_group_ids(h.id),
    h.private_checkins
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

-- ── 6. Offline check-ins can be private too ──
--
-- 027's batch, which the offline queue drains through, gains an is_private
-- flag per item. It stays one atomic call, so a drain that fails partway
-- never leaves half a chunk in to be sent again.
--
-- A queued item loses its media on the way (the queue never keeps a file),
-- so a private photo taken offline can arrive with nothing left to keep. It
-- lands as a plain quick check-in: nothing to hide, and nothing to share.

CREATE OR REPLACE FUNCTION insert_completions_batch(
  p_items JSONB
)
RETURNS SETOF completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item RECORD;
  v_bad_id UUID;
  v_completion completions;
  v_evidence TEXT;
  v_notes TEXT;
BEGIN
  SELECT (item->>'habit_id')::UUID INTO v_bad_id
  FROM jsonb_array_elements(p_items) AS item
  WHERE NOT EXISTS (
    SELECT 1 FROM habits h
    WHERE h.id = (item->>'habit_id')::UUID AND h.user_id = v_uid
  )
  LIMIT 1;

  IF v_bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'Habit % not found or not owned', v_bad_id
      USING ERRCODE = '42501';
  END IF;

  FOR v_item IN
    SELECT
      (item->>'habit_id')::UUID AS habit_id,
      (item->>'completion_type')::completion_type AS completion_type,
      nullif(item->>'evidence_url', '') AS evidence_url,
      nullif(btrim(coalesce(item->>'notes', '')), '') AS notes,
      coalesce((item->>'is_private')::boolean, false) AS is_private,
      CASE WHEN (item->>'completion_type')::completion_type = 'rain_check'
           THEN NULLIF(item->>'rain_check_reason', '')::rain_check_reason
           ELSE NULL END AS rain_check_reason,
      CASE WHEN (item->>'completion_type')::completion_type = 'rain_check'
           THEN NULLIF(item->>'rain_check_moved_to', '')::date
           ELSE NULL END AS rain_check_moved_to
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(item, ord)
    ORDER BY ord
  LOOP
    IF v_item.is_private
       AND v_item.completion_type IN ('photo', 'video', 'voice', 'message') THEN
      v_evidence := v_item.evidence_url;
      v_notes := v_item.notes;

      IF v_evidence IS NOT NULL
         AND (split_part(v_evidence, '/', 1) != v_uid::text
              OR split_part(v_evidence, '/', 2) != 'private') THEN
        RAISE EXCEPTION 'Private media must be in your private folder'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO completions (habit_id, user_id, completion_type)
      VALUES (v_item.habit_id, v_uid, 'quick')
      RETURNING * INTO v_completion;

      IF v_evidence IS NOT NULL OR v_notes IS NOT NULL THEN
        INSERT INTO completion_private_content (
          completion_id, user_id, completion_type, evidence_url, notes
        )
        VALUES (v_completion.id, v_uid, v_item.completion_type, v_evidence, v_notes);
      END IF;
    ELSE
      INSERT INTO completions (
        habit_id, user_id, completion_type, evidence_url, notes,
        rain_check_reason, rain_check_moved_to
      )
      VALUES (
        v_item.habit_id, v_uid, v_item.completion_type,
        v_item.evidence_url, v_item.notes,
        v_item.rain_check_reason, v_item.rain_check_moved_to
      )
      RETURNING * INTO v_completion;
    END IF;

    RETURN NEXT v_completion;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION insert_completions_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_completions_batch(JSONB) TO authenticated;
