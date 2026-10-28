-- ============================================================
-- 048_missed_alert_timing.sql — when a missed habit is told
-- ============================================================
--
-- Four things were wrong with when partners were told a habit was missed,
-- and one with reminders:
--
--   1. A window that closes at 11 PM or later was never told. The check
--      runs on the hour and only looked at the owner's today: at 11 PM the
--      window had not closed, and at midnight the day was over. Where the
--      clock is half an hour off UTC, as in India, the check falls at :30
--      and everything closing after 11:30 PM was lost.
--   2. A partner in quiet hours when a window closed heard on the first run
--      after them only if the owner's day was not over by then. With the
--      default quiet hours, 10 PM to 7 AM, that was never for a window
--      closing after 9 PM.
--   3. A habit created, given a time, moved earlier or put on today after
--      that window had closed today was told missed within the hour, about
--      a window that did not exist when it closed. Created at 3 PM with an
--      8 AM window, its partners heard at 4 that it was missed.
--   4. A partner was told about a window that closed before they were one:
--      accepted at 3 PM, they heard at 4 about the morning. A partner sees
--      check-ins only from when they became one (040); misses now follow.
--
--   And a time moved later after the day's reminder had gone out was not
--   reminded again: reminders are once a day, so the new time passed in
--   silence.
--
-- get_missed_habits now looks at the owner's yesterday as well as today, so
-- a window that closed late, or a partner who was asleep, is told on the
-- first run that can: after midnight, or when quiet hours end. A day is told
-- only if its window closed after the habit's timing was last set and after
-- the partner became one, and never on a paused day. Each partner hears
-- about one day per habit at most: the latest, when yesterday and today were
-- both missed and neither told. owner_today comes back with each row, so
-- check-missed-habits can say "yesterday".
--
-- habits.timing_changed_at is when the window, the days or the frequency
-- last changed, set by a trigger, which also re-arms the day's reminder.
-- Before a habit's first change, created_at stands in for it.
--
-- The partner's missed badge and inbox read today only, as before, and take
-- the same two rules.
--
-- Last, a stored time is now held to a time of day. valid_time_window took
-- any two digits each side, and reminders cast the start to a time: one
-- habit saved with 99:99 made every user's reminders fail. Rows already
-- stored are not checked again, so the functions below also pass over a
-- time that is not one rather than failing on it.
--
-- check-missed-habits must be deployed with this migration: the old one
-- reads the new rows as it read the old, just without "yesterday".

-- ── 1. A time is a time of day ──

CREATE OR REPLACE FUNCTION public.habit_time(p TEXT)
RETURNS TIME
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN p ~ '^([01]\d|2[0-3]):[0-5]\d$' THEN p::time END;
$$;

-- 045's body, with the hours and minutes held to a clock's. A missing start
-- or end still passes, as it always has.
CREATE OR REPLACE FUNCTION public.is_valid_time_window(tw jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_day TEXT;
  v_window JSONB;
  v_time CONSTANT TEXT := '^([01]\d|2[0-3]):[0-5]\d$';
BEGIN
  IF tw IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(tw) <> 'object' THEN RETURN false; END IF;

  IF (tw->>'start') !~ v_time OR (tw->>'end') !~ v_time THEN
    RETURN false;
  END IF;

  IF NOT tw ? 'days' THEN RETURN true; END IF;
  IF jsonb_typeof(tw->'days') <> 'object' THEN RETURN false; END IF;

  FOR v_day, v_window IN SELECT key, value FROM jsonb_each(tw->'days') LOOP
    IF v_day !~ '^[0-6]$' THEN RETURN false; END IF;
    CONTINUE WHEN jsonb_typeof(v_window) = 'null';
    IF jsonb_typeof(v_window) <> 'object'
       OR coalesce(v_window->>'start', '') !~ v_time
       OR coalesce(v_window->>'end', '') !~ v_time THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- ── 2. When a habit's timing was last set ──

ALTER TABLE public.habits
  ADD COLUMN IF NOT EXISTS timing_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.habits.timing_changed_at IS
  'When the time window, the days or the frequency last changed; null until the first change, when created_at stands in. A window that closed before then is not told missed. Set by habits_timing_changed.';

-- Days as a set: [1,3,5] and [5,3,1] are the same schedule.
CREATE OR REPLACE FUNCTION public.same_days(a JSONB, b JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(a, '[]') @> coalesce(b, '[]')
     AND coalesce(b, '[]') @> coalesce(a, '[]');
$$;

-- Runs after habits_normalize_time_window (triggers of a kind fire in name
-- order), so a save that sends the window it already had — every save from
-- the edit sheet does — is no change.
CREATE OR REPLACE FUNCTION public.note_timing_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.time_window IS DISTINCT FROM OLD.time_window
     OR NEW.frequency IS DISTINCT FROM OLD.frequency
     OR NOT public.same_days(NEW.schedule->'days', OLD.schedule->'days') THEN
    NEW.timing_changed_at := now();
    -- Today's reminder goes out again at the new time, if that is still to
    -- come. A start already past is not reminded today either way.
    NEW.last_reminder_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.note_timing_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS habits_timing_changed ON public.habits;
CREATE TRIGGER habits_timing_changed
  BEFORE UPDATE OF time_window, schedule, frequency ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.note_timing_change();

-- ── 3. Who is told a habit was missed, and about which day ──
--
-- 046's body, over the owner's today and yesterday. Yesterday's window has
-- always closed; today's once its end has passed, to the minute, as before.
-- A paused habit is passed over as before; so is a day that was paused,
-- which yesterday can be once the habit is resumed today.

DROP FUNCTION IF EXISTS public.get_missed_habits(TIMESTAMPTZ);

CREATE FUNCTION public.get_missed_habits(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  share_id    UUID,
  habit_id    UUID,
  title       TEXT,
  emoji       TEXT,
  user_id     UUID,
  user_name   TEXT,
  partner_id  UUID,
  owner_date  DATE,
  owner_today DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (hs.id)
         hs.id, h.id, h.title, h.emoji, h.user_id, p.display_name,
         hs.shared_with, d.day, owner_day.today
  FROM habits h
  JOIN profiles p ON p.id = h.user_id
  CROSS JOIN LATERAL (
    SELECT coalesce(p.timezone, 'UTC') AS tz,
           (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS today,
           date_trunc('minute', check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::time AS now_time
  ) owner_day
  CROSS JOIN LATERAL (
    SELECT v.day, EXTRACT(DOW FROM v.day)::int AS dow
    FROM (VALUES (owner_day.today), (owner_day.today - 1)) AS v(day)
  ) d
  CROSS JOIN LATERAL (
    SELECT habit_time(w->>'start') AS starts, habit_time(w->>'end') AS ends
    FROM (SELECT habit_window_on(h.time_window, d.dow) AS w) x
  ) day_window
  CROSS JOIN LATERAL (
    SELECT (d.day + day_window.ends) AT TIME ZONE owner_day.tz AS closed_at
  ) closing
  JOIN habit_shares hs ON hs.habit_id = h.id
  JOIN profiles partner ON partner.id = hs.shared_with
  WHERE h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(d.dow)
    -- NULL on a day with no window, which is never missed; nor is one that
    -- ends before it starts.
    AND day_window.ends > day_window.starts
    AND (d.day < owner_day.today OR day_window.ends < owner_day.now_time)
    -- A window put in place after it closed was never missed.
    AND closing.closed_at > coalesce(h.timing_changed_at, h.created_at, '-infinity')
    AND habit_pause_start(h.id, d.day) IS NULL
    AND (h.frequency <> 'weekly' OR d.dow = 6)
    AND NOT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date <= d.day
        AND c.completed_date >= CASE WHEN h.frequency = 'weekly'
                                     THEN d.day - d.dow
                                     ELSE d.day END
    )
    AND hs.status = 'accepted'
    AND hs.notify_miss = true
    -- Only a window that closed since they became a partner.
    AND closing.closed_at > coalesce(hs.responded_at, hs.created_at, '-infinity')
    -- Told about a later day, an earlier one is not told after it.
    AND (hs.last_miss_alert_date IS NULL OR hs.last_miss_alert_date < d.day)
    AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = hs.shared_with)
    AND (partner.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
    AND (partner.notification_prefs->>'miss_alerts') IS DISTINCT FROM 'false'
    AND NOT is_in_quiet_hours(partner.notification_prefs, partner.timezone)
  ORDER BY hs.id, d.day DESC;
$$;

-- Recreated, so Supabase's grants by name are back (043). Only
-- check-missed-habits calls it.
REVOKE ALL ON FUNCTION public.get_missed_habits(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_missed_habits(TIMESTAMPTZ) TO service_role;

-- ── 4. A partner's missed badge and inbox ──
--
-- 046's bodies, with the window set before it closed and the partner a
-- partner by then. Both read today in the partner's own timezone, as before.

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
  CROSS JOIN LATERAL (
    SELECT (v_today_date
            + habit_time(habit_window_on(h.time_window, v_today_dow)->>'end'))
           AT TIME ZONE p_timezone AS closed_at
  ) closing
  WHERE hs.shared_with = auth.uid()
    AND hs.status = 'accepted'
    AND h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(v_today_dow)
    -- Only count habits whose window today has ended — and ends after it
    -- starts
    AND (habit_window_on(h.time_window, v_today_dow)->>'end') < v_now_time
    AND (habit_window_on(h.time_window, v_today_dow)->>'end')
        > (habit_window_on(h.time_window, v_today_dow)->>'start')
    AND closing.closed_at > coalesce(h.timing_changed_at, h.created_at, '-infinity')
    AND closing.closed_at > coalesce(hs.responded_at, hs.created_at, '-infinity')
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
  CROSS JOIN LATERAL (
    -- The day's start, plus the end's time of day.
    SELECT p_day_start
           + (public.habit_time(day_window.w->>'end') - time '00:00') AS closed_at
  ) closing
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
    AND closing.closed_at > coalesce(h.timing_changed_at, h.created_at, '-infinity')
    AND closing.closed_at > coalesce(hs.responded_at, hs.created_at, '-infinity')
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

-- ── 5. Reminders pass over a time that is not one ──
--
-- 045's body, reading the start through habit_time(): a start stored before
-- section 1 that is not a time of day is no start, rather than an error that
-- stops every user's reminders.

CREATE OR REPLACE FUNCTION get_habits_due_for_reminder(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  user_id UUID,
  notification_prefs JSONB,
  timezone TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT h.id, h.title, h.emoji, h.user_id,
         p.notification_prefs, p.timezone
  FROM public.habits h
  JOIN public.profiles p ON p.id = h.user_id
  CROSS JOIN LATERAL (
    SELECT check_ts AT TIME ZONE coalesce(p.timezone, 'UTC') AS local_ts
  ) owner_day
  CROSS JOIN LATERAL (
    SELECT public.habit_time(public.habit_window_on(
      h.time_window, EXTRACT(DOW FROM owner_day.local_ts)::int
    )->>'start') AS starts
  ) day_window
  WHERE h.is_paused = false
    AND day_window.starts IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.id)
    AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
    AND (p.notification_prefs->>'habit_reminders') IS DISTINCT FROM 'false'
    -- Scheduled for today in user's timezone
    AND (h.schedule->'days') @> to_jsonb(EXTRACT(DOW FROM owner_day.local_ts)::int)
    -- Start time is within the current 15-minute window in user's timezone.
    -- Compared as times to handle the midnight boundary correctly (e.g.
    -- 23:50 + 15min wraps to 00:05, which breaks string comparison).
    AND day_window.starts >= owner_day.local_ts::time
    AND (
      -- Normal case: window doesn't cross midnight
      (  owner_day.local_ts::time < (owner_day.local_ts + interval '15 minutes')::time
         AND day_window.starts < (owner_day.local_ts + interval '15 minutes')::time
      )
      OR
      -- Midnight wrap: window end is smaller than window start
      (  owner_day.local_ts::time > (owner_day.local_ts + interval '15 minutes')::time
         AND (
           day_window.starts >= owner_day.local_ts::time
           OR day_window.starts < (owner_day.local_ts + interval '15 minutes')::time
         )
      )
    )
    -- Not already done today — this week, for a weekly habit
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_date <= owner_day.local_ts::date
        AND c.completed_date >= CASE WHEN h.frequency = 'weekly'
                                     THEN owner_day.local_ts::date
                                          - EXTRACT(DOW FROM owner_day.local_ts)::int
                                     ELSE owner_day.local_ts::date END
    )
    -- Not already reminded today (deduplication)
    AND (h.last_reminder_date IS NULL
      OR h.last_reminder_date < owner_day.local_ts::date
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
