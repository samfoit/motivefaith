-- Chat habit strips show only today's habits.
--
-- The strip at the top of a friend's or group's chat answers one question:
-- what's done and what's still open today. It needs to know which shared
-- habits are on today's list at all — a weekday habit on a Saturday is not
-- "not done", it is not due. Both functions are their latest bodies (034 and
-- 027) with `due_today` added to each habit; nothing else changes.

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
      h.schedule,
      coalesce(h.is_paused, false) AS is_paused,
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
        -- On today's list: scheduled for today (or a rain check moved it
        -- here) and not paused — the dashboard's own rule — or already
        -- checked in or rain-checked today, whatever the schedule says.
        'due_today', (
          (
            NOT hd.is_paused
            AND (
              (hd.schedule->'days') @> to_jsonb(EXTRACT(DOW FROM (SELECT d FROM today_local))::int)
              OR EXISTS (
                SELECT 1 FROM completions rc
                WHERE rc.habit_id = hd.id
                  AND rc.user_id = hd.owner_id
                  AND rc.completion_type = 'rain_check'
                  AND rc.rain_check_moved_to = (SELECT d FROM today_local)
              )
            )
          )
          OR EXISTS (
            SELECT 1 FROM completions_30d c2
            WHERE c2.habit_id = hd.id
              AND c2.user_id = hd.owner_id
              AND c2.completed_date = (SELECT d FROM today_local)
          )
        ),
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

CREATE OR REPLACE FUNCTION get_group_timeline_activity(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  habits        JSONB,
  completions   JSONB,
  user_timezone TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s group data';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Forbidden: user is not a member of this group'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  WITH shared_habit_ids AS (
    SELECT ghs.habit_id
    FROM group_habit_shares ghs
    WHERE ghs.group_id = p_group_id
  ),
  challenge_habit_ids AS (
    SELECT DISTINCT gcp.habit_id
    FROM group_challenge_participants gcp
    JOIN group_challenges gc ON gc.id = gcp.challenge_id
    WHERE gc.group_id = p_group_id
      AND gc.is_active = true
      AND gcp.habit_id IS NOT NULL
  ),
  all_habit_ids AS (
    SELECT habit_id FROM shared_habit_ids
    UNION
    SELECT habit_id FROM challenge_habit_ids
  ),
  habit_details AS (
    SELECT
      h.id,
      h.title,
      coalesce(h.emoji, '✅') AS emoji,
      coalesce(h.color, '#6366F1') AS color,
      coalesce(h.category, 'general') AS category,
      coalesce(h.streak_current, 0) AS streak_current,
      h.user_id AS owner_id,
      h.schedule,
      coalesce(h.is_paused, false) AS is_paused,
      coalesce(p.display_name, 'Unknown') AS owner_name,
      p.avatar_url AS owner_avatar,
      EXISTS (
        SELECT 1 FROM shared_habit_ids shi WHERE shi.habit_id = h.id
      ) AS is_shared
    FROM all_habit_ids ahi
    JOIN habits h ON h.id = ahi.habit_id
    LEFT JOIN profiles p ON p.id = h.user_id
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
    WHERE c.habit_id IN (SELECT habit_id FROM all_habit_ids)
      AND c.completed_at > now() - interval '30 days'
    ORDER BY c.completed_at DESC
    LIMIT 100
  ),
  completion_reactions AS (
    SELECT
      gcr.completion_id,
      jsonb_agg(jsonb_build_object(
        'id', gcr.id,
        'user_id', gcr.user_id,
        'emoji', gcr.emoji
      )) AS reactions
    FROM group_completion_reactions gcr
    WHERE gcr.completion_id IN (SELECT id FROM completions_30d)
    GROUP BY gcr.completion_id
  )
  SELECT
    -- habits: only those from group_habit_shares (matching current page behavior)
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', hd.id,
        'title', hd.title,
        'emoji', hd.emoji,
        'color', hd.color,
        'category', hd.category,
        'streak_current', hd.streak_current,
        'owner_id', hd.owner_id,
        'owner_name', hd.owner_name,
        'owner_avatar', hd.owner_avatar,
        -- On today's list: scheduled for today (or a rain check moved it
        -- here) and not paused — the dashboard's own rule — or already
        -- checked in or rain-checked today, whatever the schedule says.
        'due_today', (
          (
            NOT hd.is_paused
            AND (
              (hd.schedule->'days') @> to_jsonb(EXTRACT(DOW FROM (SELECT d FROM today_local))::int)
              OR EXISTS (
                SELECT 1 FROM completions rc
                WHERE rc.habit_id = hd.id
                  AND rc.user_id = hd.owner_id
                  AND rc.completion_type = 'rain_check'
                  AND rc.rain_check_moved_to = (SELECT d FROM today_local)
              )
            )
          )
          OR EXISTS (
            SELECT 1 FROM completions_30d c2
            WHERE c2.habit_id = hd.id
              AND c2.user_id = hd.owner_id
              AND c2.completed_date = (SELECT d FROM today_local)
          )
        ),
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
      ) ORDER BY hd.title)
      FROM habit_details hd
      WHERE hd.is_shared = true),
      '[]'::jsonb
    ),

    -- completions: all habits (shared + challenge), with user/habit info + reactions
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
        'user_name', coalesce(p.display_name, 'Unknown'),
        'user_avatar', p.avatar_url,
        'habit_emoji', hd.emoji,
        'habit_title', hd.title,
        'habit_color', hd.color,
        'reactions', coalesce(cr.reactions, '[]'::jsonb)
      ) ORDER BY c.completed_at DESC)
      FROM completions_30d c
      JOIN habit_details hd ON hd.id = c.habit_id
      LEFT JOIN profiles p ON p.id = c.user_id
      LEFT JOIN completion_reactions cr ON cr.completion_id = c.id),
      '[]'::jsonb
    ),

    (SELECT tz FROM viewer_tz);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_group_timeline_activity(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_group_timeline_activity(UUID, UUID) TO authenticated;
