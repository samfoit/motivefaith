-- ============================================================
-- 002_rls_policies.sql — Row Level Security policies
-- ============================================================

-- ── Enable RLS on all tables ──

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE encouragements ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_habit_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_completion_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_code_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_search_log ENABLE ROW LEVEL SECURITY;

-- ── Helper functions (SECURITY DEFINER, must precede policies) ──

CREATE OR REPLACE FUNCTION public.is_habit_owner(h_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.habits
    WHERE id = h_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_member(g_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = g_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(g_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = g_id AND user_id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_completion_in_group(c_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM completions c
    WHERE c.id = c_id
      AND EXISTS (
        SELECT 1
        FROM group_habit_shares ghs
        WHERE ghs.habit_id = c.habit_id
          AND EXISTS (
            SELECT 1
            FROM group_members gm
            WHERE gm.group_id = ghs.group_id
              AND gm.user_id = auth.uid()
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_app_admin() FROM anon;

-- ── profiles ──

CREATE POLICY "Anon cannot read profiles"
  ON profiles FOR SELECT
  TO anon
  USING (false);

CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users read accepted friends profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.register_id = auth.uid() AND f.addressee_id = profiles.id)
          OR (f.register_id = profiles.id AND f.addressee_id = auth.uid())
        )
    )
  );

CREATE POLICY "Users read fellow group member profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM group_members gm1
      JOIN group_members gm2 ON gm2.group_id = gm1.group_id
      WHERE gm1.user_id = auth.uid()
        AND gm2.user_id = profiles.id
    )
  );

CREATE POLICY "Users read pending friendship profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'pending'
        AND (
          (f.register_id = auth.uid() AND f.addressee_id = profiles.id)
          OR (f.register_id = profiles.id AND f.addressee_id = auth.uid())
        )
    )
  );

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── habits ──

CREATE POLICY "Own habits full access"
  ON habits FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Shared habits readable"
  ON habits FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM habit_shares
      WHERE habit_id = habits.id
        AND shared_with = auth.uid()
    )
  );

-- ── completions ──

CREATE POLICY "Own completions select"
  ON completions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Own completions insert"
  ON completions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM habits
      WHERE id = habit_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Own completions delete"
  ON completions FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Shared completions readable"
  ON completions FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM habit_shares
      WHERE habit_id = completions.habit_id
        AND shared_with = auth.uid()
    )
  );

CREATE POLICY "Admins can delete completions"
  ON completions FOR DELETE
  USING (is_app_admin());

-- ── habit_shares ──

CREATE POLICY "Habit owner manages shares"
  ON habit_shares FOR ALL USING (
    public.is_habit_owner(habit_id)
  );

CREATE POLICY "Shared-with user can view shares"
  ON habit_shares FOR SELECT USING (
    shared_with = auth.uid()
  );

-- ── friendships ──

CREATE POLICY "Friendship select"
  ON friendships FOR SELECT
  USING (auth.uid() IN (register_id, addressee_id));

CREATE POLICY "Friendship insert"
  ON friendships FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = register_id);

CREATE POLICY "Friendship update"
  ON friendships FOR UPDATE
  TO authenticated
  USING (auth.uid() = addressee_id)
  WITH CHECK (auth.uid() = addressee_id);

CREATE POLICY "Friendship delete"
  ON friendships FOR DELETE
  USING (auth.uid() IN (register_id, addressee_id));

-- ── encouragements ──

CREATE POLICY "Encouragement read"
  ON encouragements FOR SELECT
  USING (auth.uid() IN (user_id, recipient_id));

CREATE POLICY "Encouragement insert"
  ON encouragements FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_id != recipient_id
    AND EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((register_id = user_id AND addressee_id = recipient_id)
          OR (register_id = recipient_id AND addressee_id = user_id))
    )
  );

CREATE POLICY "Encouragement delete"
  ON encouragements FOR DELETE
  USING (auth.uid() IN (user_id, recipient_id));

CREATE POLICY "Recipient can mark read"
  ON encouragements FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- ── groups ──

CREATE POLICY "Members can view groups"
  ON groups FOR SELECT
  USING (is_group_member(id));

CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can update groups"
  ON groups FOR UPDATE
  USING (is_group_admin(id));

CREATE POLICY "Admins can delete groups"
  ON groups FOR DELETE
  USING (is_group_admin(id));

-- ── group_members ──

CREATE POLICY "Members can view group members"
  ON group_members FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Admins can add members"
  ON group_members FOR INSERT
  TO authenticated
  WITH CHECK (is_group_admin(group_id));

CREATE POLICY "Admins can update members"
  ON group_members FOR UPDATE
  USING (is_group_admin(group_id));

CREATE POLICY "Members can leave or admins can remove"
  ON group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR is_group_admin(group_id)
  );

-- ── group_habit_shares ──

CREATE POLICY "Members can view group habit shares"
  ON group_habit_shares FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Members can share own habits"
  ON group_habit_shares FOR INSERT
  TO authenticated
  WITH CHECK (
    is_group_member(group_id)
    AND shared_by = auth.uid()
  );

CREATE POLICY "Habit owners can unshare"
  ON group_habit_shares FOR DELETE
  USING (shared_by = auth.uid());

-- ── group_challenges ──

CREATE POLICY "Members can view challenges"
  ON group_challenges FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Admins can create challenges"
  ON group_challenges FOR INSERT
  TO authenticated
  WITH CHECK (is_group_admin(group_id));

CREATE POLICY "Admins can update challenges"
  ON group_challenges FOR UPDATE
  USING (is_group_admin(group_id));

CREATE POLICY "Admins can delete challenges"
  ON group_challenges FOR DELETE
  USING (is_group_admin(group_id));

-- ── group_challenge_participants ──

CREATE POLICY "Members can view participants"
  ON group_challenge_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_challenges gc
      WHERE gc.id = challenge_id
      AND is_group_member(gc.group_id)
    )
  );

CREATE POLICY "Members can join challenges"
  ON group_challenge_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM group_challenges gc
      WHERE gc.id = challenge_id
      AND is_group_member(gc.group_id)
    )
  );

CREATE POLICY "Members can leave challenges"
  ON group_challenge_participants FOR DELETE
  USING (user_id = auth.uid());

-- ── group_messages ──

CREATE POLICY "Members can view messages"
  ON group_messages FOR SELECT
  USING (is_group_member(group_id));

CREATE POLICY "Members can send messages"
  ON group_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    is_group_member(group_id)
    AND user_id = auth.uid()
  );

CREATE POLICY "Admins can delete group messages"
  ON group_messages FOR DELETE
  USING (is_app_admin());

-- ── group_message_reactions ──

CREATE POLICY "Group members can view reactions"
  ON group_message_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM group_messages gm
      JOIN group_members gmem ON gmem.group_id = gm.group_id
                              AND gmem.user_id = auth.uid()
      WHERE gm.id = group_message_reactions.message_id
    )
  );

CREATE POLICY "Group members can add reactions"
  ON group_message_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM group_messages gm
      JOIN group_members gmem ON gmem.group_id = gm.group_id
                              AND gmem.user_id = auth.uid()
      WHERE gm.id = group_message_reactions.message_id
    )
  );

CREATE POLICY "Users can remove own reactions"
  ON group_message_reactions FOR DELETE
  USING (user_id = auth.uid());

-- ── group_completion_reactions ──

CREATE POLICY "Group members can view completion reactions"
  ON group_completion_reactions FOR SELECT
  USING (can_view_completion_in_group(completion_id));

CREATE POLICY "Group members can add completion reactions"
  ON group_completion_reactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND can_view_completion_in_group(completion_id)
  );

CREATE POLICY "Users can remove own completion reactions"
  ON group_completion_reactions FOR DELETE
  USING (user_id = auth.uid());

-- ── content_reports ──

CREATE POLICY "Users can create reports"
  ON content_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Users can view own reports"
  ON content_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY "Admins can view all reports"
  ON content_reports FOR SELECT
  TO authenticated
  USING (is_app_admin());

CREATE POLICY "Admins can update reports"
  ON content_reports FOR UPDATE
  TO authenticated
  USING (is_app_admin())
  WITH CHECK (is_app_admin());

-- ── invite_code_attempts ──

CREATE POLICY "Users insert own attempts"
  ON invite_code_attempts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own attempts"
  ON invite_code_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── feed_access_log ──

CREATE POLICY "Users insert own feed access"
  ON feed_access_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own feed access"
  ON feed_access_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── profile_search_log ──

CREATE POLICY "Users insert own search log"
  ON profile_search_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own search log"
  ON profile_search_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Column-level revocations (sensitive PII) ──

REVOKE SELECT (push_subscription, notification_prefs) ON profiles FROM authenticated;
REVOKE SELECT (push_subscription, notification_prefs) ON profiles FROM anon;
REVOKE SELECT (date_of_birth) ON profiles FROM authenticated;
REVOKE SELECT (date_of_birth) ON profiles FROM anon;
REVOKE SELECT (is_admin) ON profiles FROM authenticated;
REVOKE SELECT (is_admin) ON profiles FROM anon;
