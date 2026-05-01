-- Self-service account deletion. Most user-owned tables do NOT cascade from
-- profiles (or from auth.users), so we must explicitly remove rows across
-- the schema before the profile row itself can be deleted. The route
-- handler that calls this RPC additionally removes storage objects and
-- calls auth.admin.deleteUser() to finish tearing down the auth user.
--
-- Groups owned (groups.created_by) by the departing user are handed off
-- where possible: first to the oldest remaining admin, then to the oldest
-- remaining member (promoted to admin), otherwise the group is deleted so
-- orphaned groups don't linger. All other group tables cascade from
-- groups / group_messages / completions already.

CREATE OR REPLACE FUNCTION delete_own_account(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_group RECORD;
  v_new_owner UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot delete another user''s account';
  END IF;

  -- Hand off / tear down groups created by this user.
  FOR v_group IN
    SELECT id FROM public.groups WHERE created_by = p_user_id
  LOOP
    -- Prefer the oldest remaining admin.
    SELECT user_id INTO v_new_owner
    FROM public.group_members
    WHERE group_id = v_group.id
      AND user_id <> p_user_id
      AND role = 'admin'
    ORDER BY joined_at ASC
    LIMIT 1;

    IF v_new_owner IS NULL THEN
      -- Otherwise promote the oldest remaining member.
      SELECT user_id INTO v_new_owner
      FROM public.group_members
      WHERE group_id = v_group.id
        AND user_id <> p_user_id
      ORDER BY joined_at ASC
      LIMIT 1;

      IF v_new_owner IS NOT NULL THEN
        UPDATE public.group_members
        SET role = 'admin'
        WHERE group_id = v_group.id AND user_id = v_new_owner;
      END IF;
    END IF;

    IF v_new_owner IS NOT NULL THEN
      UPDATE public.groups
      SET created_by = v_new_owner
      WHERE id = v_group.id;
    ELSE
      -- No one left — delete the group. Cascades handle group_members,
      -- group_habit_shares, group_challenges, group_messages, reactions.
      DELETE FROM public.groups WHERE id = v_group.id;
    END IF;
  END LOOP;

  -- Remove references from other users' activity.
  DELETE FROM public.content_reports WHERE reporter_id = p_user_id;
  UPDATE public.content_reports SET reviewed_by = NULL WHERE reviewed_by = p_user_id;

  DELETE FROM public.encouragements
    WHERE user_id = p_user_id OR recipient_id = p_user_id;

  DELETE FROM public.friendships
    WHERE register_id = p_user_id OR addressee_id = p_user_id;

  DELETE FROM public.habit_shares WHERE shared_with = p_user_id;
  DELETE FROM public.group_habit_shares WHERE shared_by = p_user_id;

  DELETE FROM public.group_challenge_participants WHERE user_id = p_user_id;
  DELETE FROM public.group_message_reactions WHERE user_id = p_user_id;
  DELETE FROM public.group_completion_reactions WHERE user_id = p_user_id;
  DELETE FROM public.group_messages WHERE user_id = p_user_id;
  DELETE FROM public.group_challenges WHERE created_by = p_user_id;
  DELETE FROM public.group_members WHERE user_id = p_user_id;

  -- Own content. completions cascade to reactions; habits cascade to
  -- remaining habit_shares / group_habit_shares / completions.
  DELETE FROM public.completions WHERE user_id = p_user_id;
  DELETE FROM public.habits WHERE user_id = p_user_id;

  -- Logs and miscellany. feed_read_cursors already cascades, but being
  -- explicit is cheap and keeps the audit simple.
  DELETE FROM public.feed_read_cursors WHERE user_id = p_user_id;
  DELETE FROM invite_code_attempts WHERE user_id = p_user_id;
  DELETE FROM feed_access_log WHERE user_id = p_user_id;
  DELETE FROM profile_search_log WHERE user_id = p_user_id;

  DELETE FROM public.profiles WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION delete_own_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_own_account(UUID) TO authenticated;
