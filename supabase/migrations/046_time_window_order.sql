-- ============================================================
-- 046_time_window_order.sql — a window that ends before it starts
-- is never missed
-- ============================================================
--
-- A habit's day is the calendar day, so its window has to open and close
-- on one. A window from 6 PM to 10 AM was checked at 11 AM for a check-in
-- dated that day, against a window that would open only that evening. Done
-- the night before, the habit was still reported missed to its partners.
--
-- The habit form no longer lets Until fall at or before From. A habit saved
-- before that, or by a build from before it, can still hold such a window,
-- and the three missed checks now pass it over: telling partners nothing is
-- better than telling them something false. Reminders are untouched; they
-- go out at the start, which such a window still has.
--
-- 045's bodies, each with the one condition added.

-- ── 1. Missed alerts ──

CREATE OR REPLACE FUNCTION public.get_missed_habits(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  share_id   UUID,
  habit_id   UUID,
  title      TEXT,
  emoji      TEXT,
  user_id    UUID,
  user_name  TEXT,
  partner_id UUID,
  owner_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT hs.id, h.id, h.title, h.emoji, h.user_id, p.display_name,
         hs.shared_with, owner_day.today
  FROM habits h
  JOIN profiles p ON p.id = h.user_id
  CROSS JOIN LATERAL (
    SELECT (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today,
           EXTRACT(DOW FROM check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::int AS dow,
           to_char(check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'), 'HH24:MI') AS now_time
  ) owner_day
  CROSS JOIN LATERAL (
    SELECT habit_window_on(h.time_window, owner_day.dow) AS w
  ) day_window
  JOIN habit_shares hs ON hs.habit_id = h.id
  JOIN profiles partner ON partner.id = hs.shared_with
  WHERE h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(owner_day.dow)
    -- NULL on a day with no window, which is never missed.
    AND (day_window.w->>'end') < owner_day.now_time
    -- Nor is one that ends before it starts.
    AND (day_window.w->>'end') > (day_window.w->>'start')
    AND (h.frequency <> 'weekly' OR owner_day.dow = 6)
    AND NOT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date <= owner_day.today
        AND c.completed_date >= CASE WHEN h.frequency = 'weekly'
                                     THEN owner_day.today - owner_day.dow
                                     ELSE owner_day.today END
    )
    AND hs.status = 'accepted'
    AND hs.notify_miss = true
    AND hs.last_miss_alert_date IS DISTINCT FROM owner_day.today
    AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = hs.shared_with)
    AND (partner.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
    AND (partner.notification_prefs->>'miss_alerts') IS DISTINCT FROM 'false'
    AND NOT is_in_quiet_hours(partner.notification_prefs, partner.timezone);
$$;

-- ── 2. A partner's missed badge ──

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
    AND hs.status = 'accepted'
    AND h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(v_today_dow)
    -- Only count habits whose window today has ended — and ends after it
    -- starts
    AND (habit_window_on(h.time_window, v_today_dow)->>'end') < v_now_time
    AND (habit_window_on(h.time_window, v_today_dow)->>'end')
        > (habit_window_on(h.time_window, v_today_dow)->>'start')
    AND (h.frequency <> 'weekly' OR v_today_dow = 6)
    AND NOT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date <= v_today_date
        AND c.completed_date >= CASE WHEN h.frequency = 'weekly'
                                     THEN v_today_date - v_today_dow
                                     ELSE v_today_date END
    );

  RETURN v_count;
END;
$$;

-- ── 3. A partner's inbox ──

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
  CROSS JOIN LATERAL (
    SELECT public.habit_window_on(h.time_window, p_day_of_week) AS w
  ) day_window
  WHERE hs.shared_with = p_user_id
    AND hs.status = 'accepted'
    AND h.is_paused = false
    AND (
      h.schedule IS NULL
      OR h.schedule->'days' @> to_jsonb(p_day_of_week)
    )
    -- Only show habits whose window today has ended — and ends after it
    -- starts
    AND (day_window.w->>'end') IS NOT NULL
    AND (day_window.w->>'end') > (day_window.w->>'start')
    AND (p_current_time IS NULL OR (day_window.w->>'end') < p_current_time)
    AND (h.frequency <> 'weekly' OR p_day_of_week = 6)
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_at >= CASE WHEN h.frequency = 'weekly'
                                   THEN p_day_start - make_interval(days => p_day_of_week)
                                   ELSE p_day_start END
        AND c.completed_at <  p_day_end
    );
$$;
