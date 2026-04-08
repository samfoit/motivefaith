-- Consolidate the journey detail page queries into a single RPC.
-- Replaces 8-10 sequential queries with one server-side call that resolves
-- shared habits (both directions), completions (30 days), and encouragements.

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
    -- Direction A: my habits shared with friend
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_user_id
    WHERE hs.shared_with = p_friend_id
    UNION
    -- Direction B: friend's habits shared with me
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_friend_id
    WHERE hs.shared_with = p_user_id
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
