-- ============================================================
-- 040_checkin_sharing_confirmation.sql — ask once before a check-in
-- first reaches somebody
-- ============================================================
--
-- A check-in is not a private log. It shows in the chat of every accepted
-- partner on the habit (get_friend_journey), on the timeline of every group
-- the habit is shared with or is in a challenge for (033), and as a push to
-- each partner (notify_completion). Nothing on the way says so, and people
-- new to the app check in thinking they are only keeping a record.
--
-- So the first check-in that would reach somebody waits for a yes: the app
-- names who it goes to and sends nothing until the user confirms. Once they
-- have, they are never asked again, on any device.
--
--   profiles.checkin_sharing_confirmed_at   when they said yes; null until then
--   get_checkin_audience()                  who each of their habits reaches,
--                                           while it is still null
--   confirm_checkin_sharing()               the yes

-- ── 1. The answer ──

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS checkin_sharing_confirmed_at TIMESTAMPTZ;

-- ── 2. People already past it ──
--
-- Anyone who has had a check-in reach somebody has seen it happen, so the
-- question is about a moment behind them. Only check-ins made after the
-- partner accepted, or after the other member was in the group with the
-- habit, count: a habit kept alone for months and given a partner yesterday
-- has not sent anything to anyone yet, and that is exactly who this is for.
--
-- A partnership or group share since removed leaves no trace, so a few
-- people whose check-ins did once go out will be asked anyway. That costs
-- them one tap.

UPDATE public.profiles p
SET checkin_sharing_confirmed_at = now()
WHERE p.checkin_sharing_confirmed_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM completions c
    WHERE c.user_id = p.id
      AND (
        EXISTS (
          SELECT 1 FROM habit_shares hs
          WHERE hs.habit_id = c.habit_id
            AND hs.status = 'accepted'
            AND hs.shared_with <> p.id
            AND c.completed_at >= coalesce(hs.responded_at, hs.created_at)
        )
        OR EXISTS (
          SELECT 1
          FROM group_habit_shares ghs
          JOIN group_members gm
            ON gm.group_id = ghs.group_id AND gm.user_id <> p.id
          WHERE ghs.habit_id = c.habit_id
            AND c.completed_at >= greatest(ghs.created_at, gm.joined_at)
        )
        OR EXISTS (
          SELECT 1
          FROM group_challenge_participants gcp
          JOIN group_challenges gc ON gc.id = gcp.challenge_id
          JOIN group_members gm
            ON gm.group_id = gc.group_id AND gm.user_id <> p.id
          WHERE gcp.habit_id = c.habit_id
            AND c.completed_at >= greatest(gcp.joined_at, gm.joined_at)
        )
      )
  );

-- ── 3. Who a check-in would reach ──
--
-- For every habit the caller owns, the people a check-in on it goes to,
-- through the same two definitions the feeds use (034): its accepted
-- partners, and its groups. A group counts only with somebody else in it —
-- a check-in seen by nobody but yourself is not the moment this is about.
--
-- Once confirmed it answers with no audience at all: the client then never
-- needs one again, and asks for this only so long as it might.

CREATE OR REPLACE FUNCTION public.get_checkin_audience()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_uid AND checkin_sharing_confirmed_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('confirmed', true, 'audience', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'confirmed', false,
    'audience', coalesce((
      -- Partners before groups, each by name.
      SELECT jsonb_agg(a ORDER BY a.habit_id, a.kind DESC, a.name)
      FROM (
        SELECT h.id AS habit_id,
               'partner' AS kind,
               pr.id,
               pr.display_name AS name,
               pr.avatar_url
        FROM habits h
        JOIN habit_shares hs ON hs.habit_id = h.id AND hs.status = 'accepted'
        JOIN profiles pr ON pr.id = hs.shared_with
        WHERE h.user_id = v_uid
          AND hs.shared_with <> v_uid

        UNION ALL

        SELECT h.id, 'group', g.id, g.name, g.avatar_url
        FROM habits h
        CROSS JOIN LATERAL unnest(habit_group_ids(h.id)) AS hg(group_id)
        JOIN groups g ON g.id = hg.group_id
        WHERE h.user_id = v_uid
          AND EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = g.id AND gm.user_id <> v_uid
          )
      ) a
    ), '[]'::jsonb)
  );
END;
$$;

-- Supabase grants new functions to anon by default, so PUBLIC alone is not
-- enough to keep signed-out callers out.
REVOKE ALL ON FUNCTION public.get_checkin_audience() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_audience() TO authenticated;

-- ── 4. The yes ──
--
-- Keeps the first answer: a second device confirming later, or a yes given
-- offline being sent again once back online, changes nothing.

CREATE OR REPLACE FUNCTION public.confirm_checkin_sharing()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles
  SET checkin_sharing_confirmed_at = now()
  WHERE id = auth.uid()
    AND checkin_sharing_confirmed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.confirm_checkin_sharing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_checkin_sharing() TO authenticated;
