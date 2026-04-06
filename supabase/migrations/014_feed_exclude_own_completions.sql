-- Fix feed preview showing the current user's own completions under a friend's row.
-- The latest_completions CTE now excludes completions by p_user_id so the preview
-- always shows the friend's activity.

CREATE OR REPLACE FUNCTION get_feed_friends(p_user_id UUID)
RETURNS TABLE (
  friend_id       UUID,
  display_name    TEXT,
  avatar_url      TEXT,
  username        TEXT,
  friendship_since TIMESTAMPTZ,
  shared_habits   JSONB,
  latest_completion JSONB,
  latest_encouragement JSONB
) AS $$
DECLARE
  v_recent INT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s feed data';
  END IF;

  SELECT count(*) INTO v_recent
  FROM feed_access_log
  WHERE user_id = auth.uid()
    AND accessed_at > now() - interval '1 minute';

  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many feed requests'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO feed_access_log (user_id) VALUES (auth.uid());

  RETURN QUERY
  WITH friends AS (
    SELECT
      CASE WHEN f.register_id = p_user_id THEN f.addressee_id ELSE f.register_id END AS fid,
      f.created_at AS since
    FROM friendships f
    WHERE (f.register_id = p_user_id OR f.addressee_id = p_user_id)
      AND f.status = 'accepted'
  ),
  shared AS (
    SELECT hs.habit_id, hs.shared_with AS fid
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_user_id
    WHERE hs.shared_with IN (SELECT fid FROM friends)
    UNION
    SELECT hs.habit_id, h.user_id AS fid
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id
    WHERE hs.shared_with = p_user_id
      AND h.user_id IN (SELECT fid FROM friends)
  ),
  friend_habits AS (
    SELECT
      s.fid,
      jsonb_agg(
        jsonb_build_object('emoji', coalesce(h.emoji, '✅'), 'title', h.title)
      ) AS habits_json
    FROM shared s
    JOIN habits h ON h.id = s.habit_id
    GROUP BY s.fid
  ),
  latest_completions AS (
    SELECT DISTINCT ON (s.fid)
      s.fid,
      jsonb_build_object(
        'habit_id', c.habit_id,
        'user_id', c.user_id,
        'completion_type', c.completion_type,
        'notes', c.notes,
        'completed_at', c.completed_at,
        'habit_emoji', coalesce(h.emoji, '✅'),
        'habit_title', h.title
      ) AS comp_json
    FROM shared s
    JOIN completions c ON c.habit_id = s.habit_id
      AND c.user_id != p_user_id
      AND c.completed_at > now() - interval '30 days'
    JOIN habits h ON h.id = c.habit_id
    ORDER BY s.fid, c.completed_at DESC
  ),
  latest_encouragements AS (
    SELECT DISTINCT ON (sub.fid)
      sub.fid,
      jsonb_build_object(
        'encouragement_type', sub.encouragement_type,
        'content', sub.content,
        'created_at', sub.created_at,
        'user_id', sub.enc_user_id
      ) AS enc_json
    FROM (
      SELECT
        fr.fid,
        e.encouragement_type,
        e.content,
        e.created_at,
        e.user_id AS enc_user_id
      FROM friends fr
      JOIN encouragements e ON
        (e.user_id = p_user_id AND e.recipient_id = fr.fid)
        OR (e.user_id = fr.fid AND e.recipient_id = p_user_id)
      WHERE e.created_at > now() - interval '30 days'
    ) sub
    ORDER BY sub.fid, sub.created_at DESC
  )
  SELECT
    fr.fid AS friend_id,
    p.display_name,
    p.avatar_url,
    p.username,
    fr.since AS friendship_since,
    coalesce(fh.habits_json, '[]'::jsonb) AS shared_habits,
    lc.comp_json AS latest_completion,
    le.enc_json AS latest_encouragement
  FROM friends fr
  JOIN profiles p ON p.id = fr.fid
  LEFT JOIN friend_habits fh ON fh.fid = fr.fid
  LEFT JOIN latest_completions lc ON lc.fid = fr.fid
  LEFT JOIN latest_encouragements le ON le.fid = fr.fid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
