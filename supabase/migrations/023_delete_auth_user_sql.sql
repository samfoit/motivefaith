-- Move auth.users deletion into Postgres so the API route doesn't need
-- to call /auth/v1/admin/users/{id} over REST. The project uses the
-- new sb_secret_* service-key format, which GoTrue's admin endpoint
-- rejects in the Authorization: Bearer header (it expects a JWT with
-- role: service_role). See supabase-js issue #1568.
--
-- Strategy: extend delete_own_account (SECURITY DEFINER, owner postgres)
-- to also delete from auth.users at the end. The function runs as
-- postgres, so postgres needs DELETE on auth.users.
--
-- PREREQUISITE — run once as supabase_auth_admin (Supabase Dashboard
-- SQL editor has the necessary role; `supabase db push` does not):
--
--   GRANT DELETE ON auth.users TO postgres;
--
-- Self-authorization is enforced by the auth.uid() check at the top of
-- delete_own_account. There is no separate code path to auth.users —
-- the DELETE is inlined, so the public cleanup always runs first.

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
    SELECT user_id INTO v_new_owner
    FROM public.group_members
    WHERE group_id = v_group.id
      AND user_id <> p_user_id
      AND role = 'admin'
    ORDER BY joined_at ASC
    LIMIT 1;

    IF v_new_owner IS NULL THEN
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
      DELETE FROM public.groups WHERE id = v_group.id;
    END IF;
  END LOOP;

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

  DELETE FROM public.completions WHERE user_id = p_user_id;
  DELETE FROM public.habits WHERE user_id = p_user_id;

  DELETE FROM public.feed_read_cursors WHERE user_id = p_user_id;
  DELETE FROM public.invite_code_attempts WHERE user_id = p_user_id;
  DELETE FROM public.feed_access_log WHERE user_id = p_user_id;
  DELETE FROM public.profile_search_log WHERE user_id = p_user_id;

  DELETE FROM public.profiles WHERE id = p_user_id;

  -- Auth user last. Cascades to auth.identities / sessions / mfa_factors.
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

REVOKE ALL ON FUNCTION delete_own_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_own_account(UUID) TO authenticated;
