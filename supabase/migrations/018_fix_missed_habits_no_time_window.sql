-- ============================================================
-- 018_fix_missed_habits_no_time_window.sql
--
-- Habits without a time_window have all day to be completed,
-- so they should not appear as "missed" until their end time
-- has actually passed. Previously both get_missed_habit_count
-- and get_inbox_missed_habits counted any uncompleted habit as
-- missed immediately at the start of the day.
-- ============================================================

-- ── Fix get_missed_habit_count ──

CREATE OR REPLACE FUNCTION public.get_missed_habit_count(p_timezone TEXT DEFAULT 'UTC')
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_dow INT;
  v_today_date DATE;
  v_now_time TEXT;
  v_count INTEGER;
BEGIN
  v_today_dow := EXTRACT(DOW FROM now() AT TIME ZONE p_timezone)::int;
  v_today_date := (now() AT TIME ZONE p_timezone)::date;
  v_now_time := to_char(now() AT TIME ZONE p_timezone, 'HH24:MI');

  SELECT count(*)::int INTO v_count
  FROM habit_shares hs
  JOIN habits h ON h.id = hs.habit_id
  WHERE hs.shared_with = auth.uid()
    AND h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(v_today_dow)
    -- Only count habits whose time window end has passed
    AND h.time_window IS NOT NULL
    AND (h.time_window->>'end') IS NOT NULL
    AND (h.time_window->>'end') < v_now_time
    AND NOT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = v_today_date
    );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION get_missed_habit_count(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_missed_habit_count(TEXT) TO authenticated;

-- ── Fix get_inbox_missed_habits ──

CREATE OR REPLACE FUNCTION public.get_inbox_missed_habits(
  p_user_id UUID,
  p_today_date DATE,
  p_day_of_week INT,
  p_day_start TIMESTAMPTZ,
  p_day_end   TIMESTAMPTZ,
  p_current_time TEXT DEFAULT NULL
)
RETURNS TABLE (
  habit_id     UUID,
  title        TEXT,
  emoji        TEXT,
  color        TEXT,
  time_window  JSONB,
  friend_id    UUID,
  friend_name  TEXT,
  friend_avatar TEXT,
  friend_username TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    h.id          AS habit_id,
    h.title,
    COALESCE(h.emoji, '✅') AS emoji,
    COALESCE(h.color, '#6366F1') AS color,
    h.time_window,
    h.user_id     AS friend_id,
    p.display_name AS friend_name,
    p.avatar_url   AS friend_avatar,
    p.username     AS friend_username
  FROM public.habit_shares hs
  JOIN public.habits h  ON h.id = hs.habit_id
  JOIN public.profiles p ON p.id = h.user_id
  WHERE hs.shared_with = p_user_id
    AND h.is_paused = false
    AND (
      h.schedule IS NULL
      OR h.schedule->'days' @> to_jsonb(p_day_of_week)
    )
    -- Only show habits whose time window end has passed
    AND h.time_window IS NOT NULL
    AND (h.time_window->>'end') IS NOT NULL
    AND (p_current_time IS NULL OR (h.time_window->>'end') < p_current_time)
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_at >= p_day_start
        AND c.completed_at <  p_day_end
    );
$$;
