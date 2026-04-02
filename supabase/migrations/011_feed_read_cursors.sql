-- ============================================================
-- 011_feed_read_cursors.sql — Track when users last read each feed
-- ============================================================

-- ── Table ──

CREATE TABLE public.feed_read_cursors (
  user_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  feed_type    TEXT NOT NULL CHECK (feed_type IN ('friend', 'group')),
  feed_id      UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feed_type, feed_id)
);

-- ── RLS ──

ALTER TABLE public.feed_read_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own cursors"
  ON public.feed_read_cursors FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cursors"
  ON public.feed_read_cursors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cursors"
  ON public.feed_read_cursors FOR UPDATE
  USING (auth.uid() = user_id);

-- ── upsert_feed_read_cursor ──

CREATE OR REPLACE FUNCTION public.upsert_feed_read_cursor(
  p_feed_type TEXT,
  p_feed_id   UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO feed_read_cursors (user_id, feed_type, feed_id, last_read_at)
  VALUES (auth.uid(), p_feed_type, p_feed_id, now())
  ON CONFLICT (user_id, feed_type, feed_id)
  DO UPDATE SET last_read_at = now();
END;
$$;

-- ── has_unread_feeds ──
-- Returns TRUE if the user has any friend feed or group chat with
-- activity newer than their read cursor.  Uses EXISTS for early exit.

CREATE OR REPLACE FUNCTION public.has_unread_feeds()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check group messages from other members newer than cursor
  IF EXISTS (
    SELECT 1
    FROM group_members gm
    JOIN group_messages msg
      ON msg.group_id = gm.group_id
      AND msg.user_id != v_uid
    LEFT JOIN feed_read_cursors frc
      ON frc.user_id = v_uid
      AND frc.feed_type = 'group'
      AND frc.feed_id = gm.group_id
    WHERE gm.user_id = v_uid
      AND msg.created_at > COALESCE(frc.last_read_at, '1970-01-01'::timestamptz)
    LIMIT 1
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check for unread encouragements from accepted friends
  IF EXISTS (
    SELECT 1
    FROM encouragements e
    JOIN friendships f
      ON f.status = 'accepted'
      AND (
        (f.register_id = v_uid AND f.addressee_id = e.user_id)
        OR (f.addressee_id = v_uid AND f.register_id = e.user_id)
      )
    WHERE e.recipient_id = v_uid
      AND e.is_read = false
    LIMIT 1
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;
