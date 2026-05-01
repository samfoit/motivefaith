-- Feed list page ("/main/feed") previews each group with its most recent
-- activity (message or habit completion). Completions are fetched directly
-- via .from("completions"), but RLS only permits reading completions that
-- the viewer owns or that are shared via habit_shares — NOT via
-- group_habit_shares. So other members' completions of a habit shared only
-- into a group never appear in the preview.
--
-- A secondary issue: the previous client-side implementation used
-- `.limit(groupIds.length * 2)`, which can mask quieter groups when one
-- habit has many recent completions.
--
-- This RPC returns exactly one latest completion per group for the given
-- user, using DISTINCT ON joined through group_habit_shares. Membership is
-- enforced so callers can only see completions from groups they belong to.

CREATE OR REPLACE FUNCTION get_feed_groups_latest_completions(
  p_user_id UUID,
  p_group_ids UUID[]
)
RETURNS TABLE (
  group_id      UUID,
  user_id       UUID,
  completed_at  TIMESTAMPTZ,
  habit_emoji   TEXT,
  habit_title   TEXT,
  user_name     TEXT
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
  )
  SELECT DISTINCT ON (ghs.group_id)
    ghs.group_id,
    c.user_id,
    c.completed_at,
    coalesce(h.emoji, '✅') AS habit_emoji,
    h.title AS habit_title,
    coalesce(p.display_name, 'Someone') AS user_name
  FROM group_habit_shares ghs
  JOIN my_groups mg ON mg.group_id = ghs.group_id
  JOIN completions c ON c.habit_id = ghs.habit_id
    AND c.completed_at > now() - interval '30 days'
  JOIN habits h ON h.id = c.habit_id
  LEFT JOIN profiles p ON p.id = c.user_id
  ORDER BY ghs.group_id, c.completed_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_feed_groups_latest_completions(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_feed_groups_latest_completions(UUID, UUID[]) TO authenticated;
