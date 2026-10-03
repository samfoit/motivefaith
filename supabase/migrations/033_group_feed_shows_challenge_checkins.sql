-- ============================================================
-- 033_group_feed_shows_challenge_checkins.sql — a group's preview
-- should say what the group's timeline says
-- ============================================================
--
-- The group-side twin of 032. A group's row in the feed is a preview of the
-- timeline behind it, but the two read different habits:
--
--   get_group_timeline_activity       group_habit_shares
--                                     ∪ habits joined to an *active* challenge
--   get_feed_groups_latest_completions group_habit_shares only
--
-- So checking in on a challenge habit put the check-in on the group's
-- timeline while the feed row went on saying "No activity yet" (or showed
-- something older).
--
-- The habit set below is copied from the timeline's CTEs verbatim, so the
-- two cannot drift apart again on that question. Everything else — the
-- auth check, the 30-day window, DISTINCT ON ... ORDER BY completed_at DESC
-- picking whoever acted last, the return shape — is reproduced from 025
-- unaltered.

CREATE OR REPLACE FUNCTION get_feed_groups_latest_completions(
  p_user_id UUID,
  p_group_ids UUID[]
)
RETURNS TABLE (
  group_id        UUID,
  user_id         UUID,
  completed_at    TIMESTAMPTZ,
  completion_type completion_type,
  habit_emoji     TEXT,
  habit_title     TEXT,
  user_name       TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s feed data';
  END IF;

  RETURN QUERY
  WITH my_groups AS (
    SELECT gm.group_id
    FROM group_members gm
    WHERE gm.user_id = p_user_id
      AND gm.group_id = ANY(p_group_ids)
  ),
  group_habits AS (
    SELECT ghs.group_id, ghs.habit_id
    FROM group_habit_shares ghs
    JOIN my_groups mg ON mg.group_id = ghs.group_id
    UNION
    SELECT gc.group_id, gcp.habit_id
    FROM group_challenge_participants gcp
    JOIN group_challenges gc ON gc.id = gcp.challenge_id
    JOIN my_groups mg ON mg.group_id = gc.group_id
    WHERE gc.is_active = true
      AND gcp.habit_id IS NOT NULL
  )
  SELECT DISTINCT ON (gh.group_id)
    gh.group_id,
    c.user_id,
    c.completed_at,
    c.completion_type,
    coalesce(h.emoji, '✅') AS habit_emoji,
    h.title AS habit_title,
    coalesce(p.display_name, 'Someone') AS user_name
  FROM group_habits gh
  JOIN completions c ON c.habit_id = gh.habit_id
    AND c.completed_at > now() - interval '30 days'
  JOIN habits h ON h.id = c.habit_id
  LEFT JOIN profiles p ON p.id = c.user_id
  ORDER BY gh.group_id, c.completed_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_feed_groups_latest_completions(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_feed_groups_latest_completions(UUID, UUID[]) TO authenticated;
