-- ============================================================
-- 054_group_invite_lookup.sql — group invite links find their group
--
-- get_group_by_invite_code (004) was declared STABLE, but it logs each
-- lookup for its rate limit, and Postgres refuses a write in a
-- non-volatile function. Every call failed with "INSERT is not allowed
-- in a non-volatile function", and the join page showed "Invite not
-- found" for every valid link.
--
-- Now VOLATILE. A signed-out caller is refused outright instead of
-- failing on the attempt log's NOT NULL user_id, and anon's execute
-- grant (a Supabase default that 004's REVOKE FROM PUBLIC left in
-- place) is taken away.
--
-- It also returns how many people are in the group. The join page shows
-- that, and counted group_members itself — which someone who has not
-- joined yet cannot read, so with the lookup working it would have said
-- "0 members" of every group. Dropped first: a function's return type
-- cannot be changed in place.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_group_by_invite_code(TEXT);

CREATE FUNCTION public.get_group_by_invite_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  avatar_url TEXT,
  member_count INTEGER
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_attempts INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO recent_attempts
  FROM invite_code_attempts
  WHERE user_id = auth.uid()
    AND attempted_at > now() - interval '1 minute';

  IF recent_attempts >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many invite code lookups'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO invite_code_attempts (user_id) VALUES (auth.uid());

  RETURN QUERY
    SELECT g.id, g.name, g.description, g.avatar_url,
           (SELECT count(*)::integer FROM group_members gm WHERE gm.group_id = g.id)
    FROM groups g
    WHERE g.invite_code = p_code
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_group_by_invite_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_by_invite_code(TEXT) TO authenticated;
