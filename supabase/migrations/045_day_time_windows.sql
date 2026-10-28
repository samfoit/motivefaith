-- ============================================================
-- 045_day_time_windows.sql — a habit's time can differ by day
-- ============================================================
--
-- A habit had one time window for every day it repeats on, so "8 on
-- weekdays, 4 at the weekend" could not be said. On a Saturday such a habit
-- was reminded at 8, its partners were told at 10 that it was missed, and it
-- sat under Morning. The only way round it was two habits, which split the
-- streak in two.
--
-- time_window keeps its shape and gains an optional map of the days that
-- differ, keyed by weekday as schedule.days is (0 = Sunday):
--
--   { "start": "08:00", "end": "09:00",
--     "days": { "0": { "start": "16:00", "end": "17:00" },
--               "6": { "start": "16:00", "end": "17:00" },
--               "2": null } }
--
-- A day that is not in the map keeps the usual start and end. A day mapped
-- to null has no set time: no reminder, no missed alert. A row without
-- "days" is every row written before this, and reads exactly as it did.
--
-- Everything that read the window now reads the day's:
--
--   get_habits_due_for_reminder   reminders, at the day's start
--   get_missed_habits             partners' missed alerts, after its end
--   get_missed_habit_count        a partner's missed badge
--   get_inbox_missed_habits       a partner's inbox
--
-- Four things were wrong with missed alerts, and are fixed here while their
-- query is rewritten anyway:
--
--   1. They went to every habit_shares row with notify_miss on, pending and
--      declined ones too: someone who said no to watching a habit was still
--      told when it was missed.
--   2. Nothing recorded that a partner had been told, and the job runs
--      hourly, so once a window closed the alert went out again every hour
--      until midnight.
--   3. A weekly habit is stored as due every day, and neither job looked at
--      frequency. One done on Monday was reminded again on Tuesday, and its
--      partners were told it was missed on any day it was not done.
--   4. The "Missed Habits" switch in a partner's notification settings
--      (miss_alerts) was saved but never read.
--
-- get_missed_habits now picks the recipients itself, one row per partner to
-- tell, so check-missed-habits must be deployed with this migration. Until
-- it is, the old function finds no habit ids in the new rows and sends
-- nothing.

-- ── 1. What a time window may hold ──
--
-- The usual start and end are checked as valid_time_window always checked
-- them, so no stored row fails the new constraint — including its leniency:
-- a missing start or end made the old expression NULL, which a CHECK lets
-- through, and the IF below lets the same NULL through. The days are new,
-- and checked strictly.
--
-- Supabase grants every new function to anon and authenticated by name
-- (043), and this one and habit_window_on keep those grants: each answers
-- only about the value passed to it, and both must stay callable. The CHECK
-- runs as whoever writes the row, and get_inbox_missed_habits runs as the
-- partner reading their inbox.

CREATE OR REPLACE FUNCTION public.is_valid_time_window(tw jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_day TEXT;
  v_window JSONB;
BEGIN
  IF tw IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(tw) <> 'object' THEN RETURN false; END IF;

  IF (tw->>'start') !~ '^\d{2}:\d{2}$' OR (tw->>'end') !~ '^\d{2}:\d{2}$' THEN
    RETURN false;
  END IF;

  IF NOT tw ? 'days' THEN RETURN true; END IF;
  IF jsonb_typeof(tw->'days') <> 'object' THEN RETURN false; END IF;

  FOR v_day, v_window IN SELECT key, value FROM jsonb_each(tw->'days') LOOP
    IF v_day !~ '^[0-6]$' THEN RETURN false; END IF;
    CONTINUE WHEN jsonb_typeof(v_window) = 'null';
    IF jsonb_typeof(v_window) <> 'object'
       OR coalesce(v_window->>'start', '') !~ '^\d{2}:\d{2}$'
       OR coalesce(v_window->>'end', '') !~ '^\d{2}:\d{2}$' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

ALTER TABLE public.habits
  DROP CONSTRAINT valid_time_window,
  ADD CONSTRAINT valid_time_window CHECK (public.is_valid_time_window(time_window));

-- ── 2. The window on a given day ──
--
-- The day's own entry if it has one, and otherwise the usual window. NULL
-- for no window that day: none at all, or a day with no set time.

CREATE OR REPLACE FUNCTION public.habit_window_on(tw jsonb, dow int)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN tw IS NULL THEN NULL
    WHEN tw->'days' ? dow::text THEN nullif(tw->'days'->(dow::text), 'null'::jsonb)
    ELSE tw - 'days'
  END;
$$;

-- ── 3. Keeping the days in step ──
--
-- Applied to every write of a habit's window, schedule or frequency:
--
--   A build from before this migration sends a window without "days" — the
--   edit sheet sends the whole window with every save, a rename included —
--   and it can stay open for days, because a new build waits for the user to
--   accept it. Its write keeps the days already stored rather than wiping
--   them. This build always sends "days", {} to clear them.
--
--   Only the days the habit repeats on keep an entry: a day taken out of the
--   schedule takes its time with it.
--
--   A weekly habit is done once, on any day, so it has no days of its own.
--
-- An empty map is dropped, so a habit with no different days is stored as
-- it always was.

CREATE OR REPLACE FUNCTION public.normalize_time_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_days JSONB;
  v_scheduled JSONB;
BEGIN
  IF NEW.time_window IS NULL OR jsonb_typeof(NEW.time_window) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NOT NEW.time_window ? 'days'
     AND jsonb_typeof(OLD.time_window) = 'object'
     AND OLD.time_window ? 'days' THEN
    NEW.time_window := NEW.time_window || jsonb_build_object('days', OLD.time_window->'days');
  END IF;

  v_days := NEW.time_window->'days';
  -- No map, or a malformed one, which the CHECK then names.
  IF v_days IS NULL OR jsonb_typeof(v_days) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF NEW.frequency = 'weekly' THEN
    v_days := '{}'::jsonb;
  ELSE
    v_scheduled := NEW.schedule->'days';
    -- A schedule with no days is every day, as everywhere else. A key that
    -- is not a weekday is kept for the CHECK to refuse.
    IF jsonb_typeof(v_scheduled) = 'array' AND jsonb_array_length(v_scheduled) > 0 THEN
      SELECT coalesce(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
        INTO v_days
        FROM jsonb_each(v_days) d
       WHERE CASE WHEN d.key ~ '^[0-6]$'
                  THEN v_scheduled @> to_jsonb(d.key::int)
                  ELSE true END;
    END IF;
  END IF;

  IF v_days = '{}'::jsonb THEN
    NEW.time_window := NEW.time_window - 'days';
  ELSE
    NEW.time_window := jsonb_set(NEW.time_window, '{days}', v_days);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS habits_normalize_time_window ON public.habits;
CREATE TRIGGER habits_normalize_time_window
  BEFORE INSERT OR UPDATE OF time_window, schedule, frequency ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.normalize_time_window();

-- ── 4. Who is told a habit was missed, and how often ──
--
-- 029's body, turned around: one row per partner to tell rather than one per
-- habit, with the recipients chosen here instead of in check-missed-habits,
-- where none of the four bugs above could be tested.
--
-- "Today" is the owner's: it is their habit's day that was missed. The
-- partner's quiet hours are their own, read at the time of the run as the
-- edge function always read them. A partner skipped for quiet hours is not
-- marked, so they hear on the first run after their quiet hours end, if the
-- day is still missed by then.
--
-- A weekly habit is missed once, when its week ends without it: on Saturday,
-- after that day's window, if nothing was logged since Sunday — the week
-- update_streak() counts (027). A rain check counts as logged here, as it
-- does for a daily habit's day.

ALTER TABLE public.habit_shares
  ADD COLUMN IF NOT EXISTS last_miss_alert_date DATE;

COMMENT ON COLUMN public.habit_shares.last_miss_alert_date IS
  'The owner''s local date this partner was last told the habit was missed. check-missed-habits sets it once the push is delivered, so a missed day is told once.';

DROP FUNCTION IF EXISTS public.get_missed_habits(TIMESTAMPTZ);

CREATE FUNCTION public.get_missed_habits(check_ts TIMESTAMPTZ DEFAULT now())
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

-- Recreated, so Supabase's grants by name are back (043), and it now names
-- every partner of every habit. Only check-missed-habits calls it.
REVOKE ALL ON FUNCTION public.get_missed_habits(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_missed_habits(TIMESTAMPTZ) TO service_role;

-- ── 5. Reminders at the day's own time ──
--
-- 036's body with two changes. The start is the day's, and a day with no set
-- time is never reminded. And a weekly habit is reminded only until it is
-- done that week, not again the next day.

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
    SELECT public.habit_window_on(
      h.time_window, EXTRACT(DOW FROM owner_day.local_ts)::int
    ) AS w
  ) day_window
  WHERE h.is_paused = false
    AND (day_window.w->>'start') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.id)
    AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
    AND (p.notification_prefs->>'habit_reminders') IS DISTINCT FROM 'false'
    -- Scheduled for today in user's timezone
    AND (h.schedule->'days') @> to_jsonb(EXTRACT(DOW FROM owner_day.local_ts)::int)
    -- Start time is within the current 15-minute window in user's timezone.
    -- Cast both sides to TIME to handle the midnight boundary correctly
    -- (e.g. 23:50 + 15min wraps to 00:05, which breaks string comparison).
    AND (day_window.w->>'start')::time >= owner_day.local_ts::time
    AND (
      -- Normal case: window doesn't cross midnight
      (  owner_day.local_ts::time < (owner_day.local_ts + interval '15 minutes')::time
         AND (day_window.w->>'start')::time < (owner_day.local_ts + interval '15 minutes')::time
      )
      OR
      -- Midnight wrap: window end is smaller than window start
      (  owner_day.local_ts::time > (owner_day.local_ts + interval '15 minutes')::time
         AND (
           (day_window.w->>'start')::time >= owner_day.local_ts::time
           OR (day_window.w->>'start')::time < (owner_day.local_ts + interval '15 minutes')::time
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

-- ── 6. A partner's missed badge and inbox ──
--
-- 029's bodies, reading the day's window and missing a weekly habit only at
-- the end of its week, as get_missed_habits does. Both already counted only
-- accepted partnerships.

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
    -- Only count habits whose window today has ended
    AND (habit_window_on(h.time_window, v_today_dow)->>'end') < v_now_time
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
  WHERE hs.shared_with = p_user_id
    AND hs.status = 'accepted'
    AND h.is_paused = false
    AND (
      h.schedule IS NULL
      OR h.schedule->'days' @> to_jsonb(p_day_of_week)
    )
    -- Only show habits whose window today has ended
    AND (day_window.w->>'end') IS NOT NULL
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
