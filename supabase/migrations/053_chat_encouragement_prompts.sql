-- ============================================================
-- 053_chat_encouragement_prompts.sql — who in a chat could use a word
-- ============================================================
--
-- When a partner's habit goes past its window with nothing logged, the inbox
-- lists it and the partner gets a push. Both lead to the chat, which said
-- nothing about it: its strip shows the same clock on the habit before its
-- window closes as after.
--
-- get_chat_late_habits lists the habits someone in a chat could use a word
-- about, for a card in that chat that only the viewer sees. Each is one of:
--
--   remind     today's window has closed, by the owner's clock, with nothing
--              logged, and their day isn't over: they may have done it and
--              not logged it, and there's still time.
--   encourage  yesterday's window closed with nothing logged that day or
--              since: the day was missed. It shows through the owner's next
--              day, and goes once they check in again.
--
-- One row per habit, its latest day, so today's reminder stands in for
-- yesterday's miss.
--
-- Which habits: a friend's chat has their habits the viewer is an accepted
-- partner on; a group's has the habits shared with it or kept for its live
-- challenges, from its other members, to members only. With neither named,
-- every friend's chat at once. That is the inbox's list, so a row there
-- always has its card in the chat it opens. The inbox used to judge "today"
-- by the viewer's clock and the chat by the owner's, so for a friend in
-- another timezone the inbox could list a habit whose chat showed nothing.
--
-- A day counts as get_missed_habits (048) counts it: on the schedule, not
-- paused, a window that ends after it starts, closed after the habit's timing
-- was last set and after the viewer could see the habit. A check-in or rain
-- check that day ends it.
--
-- Answered: the viewer has written to that person, or in that group, since
-- the window closed. A heart on an earlier check-in isn't an answer. Nothing
-- is stored for it, so it clears on every device at once, and a day that
-- goes unlogged after the answer asks again.
--
-- Each check is an index lookup over the chat's habits alone: completions
-- (habit_id, completed_date), encouragements (user_id, recipient_id,
-- created_at), group_messages (group_id, created_at, user_id).

CREATE OR REPLACE FUNCTION public.get_chat_late_habits(
  p_friend_id UUID DEFAULT NULL,
  p_group_id  UUID DEFAULT NULL,
  p_now       TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  habit_id     UUID,
  title        TEXT,
  emoji        TEXT,
  color        TEXT,
  owner_id     UUID,
  owner_name   TEXT,
  owner_avatar TEXT,
  kind         TEXT,
  day          DATE,
  closed_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH chat_habits AS (
    -- A friend's habits you are an accepted partner on: one friend's, or
    -- with no chat named, every friend's.
    SELECT hs.habit_id,
           coalesce(hs.responded_at, hs.created_at) AS visible_since
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id
    WHERE p_group_id IS NULL
      AND (p_friend_id IS NULL OR h.user_id = p_friend_id)
      AND hs.shared_with = auth.uid()
      AND hs.status = 'accepted'

    UNION ALL

    -- A group's habits: shared with it, or kept for one of its live
    -- challenges. Seen from when both the habit and you were there.
    SELECT g.habit_id, greatest(g.since, gm.joined_at) AS visible_since
    FROM (
      SELECT ghs.habit_id, ghs.created_at AS since
      FROM group_habit_shares ghs
      WHERE ghs.group_id = p_group_id
      UNION ALL
      SELECT gcp.habit_id, gcp.joined_at
      FROM group_challenge_participants gcp
      JOIN group_challenges gc ON gc.id = gcp.challenge_id
      WHERE gc.group_id = p_group_id
        AND gc.is_active = true
        AND gcp.habit_id IS NOT NULL
    ) g
    JOIN group_members gm
      ON gm.group_id = p_group_id AND gm.user_id = auth.uid()
    WHERE p_group_id IS NOT NULL
  ),
  late_days AS (
    SELECT h.id AS habit_id, h.title, coalesce(h.emoji, '✅') AS emoji,
           coalesce(h.color, '#6366F1') AS color,
           h.user_id AS owner_id, owner.display_name AS owner_name,
           owner.avatar_url AS owner_avatar,
           d.kind, d.day, closing.closed_at
    FROM chat_habits ch
    JOIN habits h ON h.id = ch.habit_id
    JOIN profiles owner ON owner.id = h.user_id
    CROSS JOIN LATERAL (
      SELECT coalesce(owner.timezone, 'UTC') AS tz,
             (p_now AT TIME ZONE coalesce(owner.timezone, 'UTC'))::date AS today
    ) owner_day
    CROSS JOIN LATERAL (
      VALUES (owner_day.today, 'remind'), (owner_day.today - 1, 'encourage')
    ) AS d(day, kind)
    CROSS JOIN LATERAL (
      SELECT EXTRACT(DOW FROM d.day)::int AS dow
    ) day_of
    CROSS JOIN LATERAL (
      SELECT habit_time(w->>'start') AS starts, habit_time(w->>'end') AS ends
      FROM (SELECT habit_window_on(h.time_window, day_of.dow) AS w) x
    ) day_window
    CROSS JOIN LATERAL (
      SELECT (d.day + day_window.ends) AT TIME ZONE owner_day.tz AS closed_at
    ) closing
    WHERE h.user_id <> auth.uid()
      AND h.is_paused = false
      AND (h.schedule->'days') @> to_jsonb(day_of.dow)
      -- NULL on a day with no window, which is never late; nor is one that
      -- ends before it starts.
      AND day_window.ends > day_window.starts
      AND closing.closed_at <= p_now
      -- A window put in place after it closed was never late, and one that
      -- closed before you could see the habit isn't yours to answer.
      AND closing.closed_at > coalesce(h.timing_changed_at, h.created_at, '-infinity')
      AND closing.closed_at > coalesce(ch.visible_since, '-infinity')
      AND habit_pause_start(h.id, d.day) IS NULL
      AND (h.frequency <> 'weekly' OR day_of.dow = 6)
      -- Nothing logged that day (that week, for a weekly habit)...
      AND NOT EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = h.id
          AND c.completed_date <= d.day
          AND c.completed_date >= CASE WHEN h.frequency = 'weekly'
                                       THEN d.day - day_of.dow
                                       ELSE d.day END
      )
      -- ...and for a missed day, nothing since: checking in again puts it
      -- behind them.
      AND (d.kind = 'remind' OR NOT EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = h.id
          AND c.completed_date > d.day
      ))
      -- Not answered: nothing written to them, or in the group, since.
      AND NOT EXISTS (
        SELECT 1 FROM encouragements e
        WHERE p_group_id IS NULL
          AND e.user_id = auth.uid()
          AND e.recipient_id = h.user_id
          AND e.created_at >= closing.closed_at
          AND e.completion_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM group_messages m
        WHERE p_group_id IS NOT NULL
          AND m.group_id = p_group_id
          AND m.user_id = auth.uid()
          AND m.created_at >= closing.closed_at
      )
  ),
  latest AS (
    -- One row per habit, its latest day. In a group a habit can also come
    -- twice, shared and in a challenge.
    SELECT DISTINCT ON (ld.habit_id) ld.*
    FROM late_days ld
    ORDER BY ld.habit_id, ld.day DESC
  )
  SELECT l.habit_id, l.title, l.emoji, l.color, l.owner_id, l.owner_name,
         l.owner_avatar, l.kind, l.day, l.closed_at
  FROM latest l
  -- Each person's together; reminders, which can still be logged, first.
  ORDER BY l.owner_name, l.owner_id, l.kind DESC, l.closed_at, l.title
  -- A chat lists them on one card; this is more than one person can use.
  LIMIT 50;
$$;

COMMENT ON FUNCTION public.get_chat_late_habits(UUID, UUID, TIMESTAMPTZ) IS
  'Habits someone could use a word about: today''s window closed with nothing logged (remind) or yesterday missed (encourage), unanswered by the caller. In one friend''s chat (p_friend_id), one group''s (p_group_id), or every friend''s (neither).';

REVOKE ALL ON FUNCTION public.get_chat_late_habits(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_late_habits(UUID, UUID, TIMESTAMPTZ) TO authenticated;
