-- ============================================================
-- 044_repeat_checkins.sql — a habit can be done more than once a day
-- ============================================================
--
-- Nothing in the schema ever limited a habit to one check-in a day.
-- update_streak() (027) lets a second real check-in on the same day through
-- without moving the streak — it adds to total_completions and stops — and
-- the same for a second one in a week on a weekly habit. What did the
-- limiting was the app, which closed a habit off once it was done. It no
-- longer does: doing a habit again is logged and shared like the first time,
-- it just doesn't add to the streak.
--
-- Three things assumed one check-in a day and catch up here:
--
--   get_habits_due_today(tz)   the capture picker's list. It left out every
--                              habit with anything logged today, so a photo
--                              could not go to a habit already done. It
--                              replaces get_incomplete_habits_today, whose
--                              name no longer fits.
--   get_habit_days_done(id)    days a habit was done on. Its rate used
--                              total_completions, which now counts a habit
--                              done twice today as two days.
--   notify_completion()        pushed every check-in to partners, so a habit
--                              done eight times a day was eight pushes. Doing
--                              it again now pushes only with something to see.

-- ── 1. The capture picker's habits ──
--
-- 039's body, with three changes. Habits checked in today stay in, flagged by
-- checked_in_today and listed after the ones still to do, so the list the
-- picker used to show is still what comes first. Rain-checked ones stay in
-- too, unflagged: a real check-in after a rain check is the day's first, as
-- on the dashboard. And a habit with no days in its schedule is due every
-- day, as update_streak() and the app have always read it.

DROP FUNCTION IF EXISTS public.get_incomplete_habits_today(TEXT);

CREATE OR REPLACE FUNCTION public.get_habits_due_today(p_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  color TEXT,
  streak_current INTEGER,
  frequency habit_frequency,
  partner_ids UUID[],
  group_ids UUID[],
  private_checkins BOOLEAN,
  checked_in_today BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_dow INT;
  v_today_date DATE;
BEGIN
  v_today_dow := EXTRACT(DOW FROM now() AT TIME ZONE p_timezone)::int;
  v_today_date := (now() AT TIME ZONE p_timezone)::date;

  RETURN QUERY
  SELECT
    h.id,
    h.title,
    -- Both as stored: the dashboard shows no emoji and no tint for a
    -- habit without one, and this list must match it.
    h.emoji,
    h.color,
    coalesce(h.streak_current, 0) AS streak_current,
    h.frequency,
    habit_partner_ids(h.id),
    habit_group_ids(h.id),
    h.private_checkins,
    today.checked_in
  FROM habits h
  -- In a subquery of its own so the ORDER BY can name it: an unqualified
  -- checked_in_today there would be read as this function's OUT parameter.
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = v_today_date
        AND c.completion_type <> 'rain_check'
    ) AS checked_in
  ) today
  WHERE h.user_id = auth.uid()
    AND h.is_paused = false
    AND (
      h.schedule->'days' IS NULL
      OR jsonb_array_length(h.schedule->'days') = 0
      OR (h.schedule->'days') @> to_jsonb(v_today_dow)
      -- …or an earlier rain check promised to make it up today.
      OR EXISTS (
        SELECT 1 FROM completions rc
        WHERE rc.habit_id = h.id
          AND rc.completion_type = 'rain_check'
          AND rc.rain_check_moved_to = v_today_date
      )
    )
  ORDER BY today.checked_in, h.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_habits_due_today(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_habits_due_today(TEXT) TO authenticated;

-- ── 2. Days a habit was done on ──
--
-- As the caller, so RLS decides whose habits it can count: the owner's own,
-- and a partner's shared ones, whose check-ins they can already read row by
-- row. Anyone else counts nothing. A rain check is a skip, not a day done.
-- idx_completions_habit_date_key (001) covers the scan.

CREATE OR REPLACE FUNCTION public.get_habit_days_done(p_habit_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(DISTINCT c.completed_date)::int
  FROM completions c
  WHERE c.habit_id = p_habit_id
    AND c.completion_type <> 'rain_check';
$$;

REVOKE ALL ON FUNCTION public.get_habit_days_done(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_habit_days_done(UUID) TO authenticated;

-- ── 3. Doing it again pushes only with something to see ──
--
-- 036's body, with an early return and a new title. Partners heard about
-- today with the first check-in, so a quick one on a habit already done
-- today returns before any push: it is still in their feed, just silent.
-- One with a photo, video, voice note or note still pushes, its title
-- ending "again". A private check-in's shared row is a plain quick one
-- (039), so it is silent too, and the push never hints that there is more
-- behind a check-in.
--
-- "Today" is the day, not the streak's week: a weekly habit done on Monday
-- and again on Thursday is news both times. And a rain check is not a
-- check-in, so the check-in that follows a skip still pushes as the first.
--
-- Also: a habit with no emoji made the title NULL, and partners got a push
-- with no title. The emoji is now left out instead.

CREATE OR REPLACE FUNCTION notify_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_habit RECORD;
  v_share RECORD;
  v_payload JSONB;
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_is_rain_check BOOLEAN;
  v_is_repeat BOOLEAN;
  v_title TEXT;
  v_body TEXT;
  v_type TEXT;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT h.title, h.emoji, p.display_name
  INTO v_habit
  FROM habits h JOIN profiles p ON p.id = h.user_id
  WHERE h.id = NEW.habit_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  v_is_rain_check := NEW.completion_type = 'rain_check';

  v_is_repeat := NOT v_is_rain_check AND EXISTS (
    SELECT 1 FROM completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date = NEW.completed_date
      AND c.completion_type <> 'rain_check'
      AND c.id <> NEW.id
  );

  IF v_is_repeat AND NEW.completion_type = 'quick' THEN
    RETURN NEW;
  END IF;

  IF v_is_rain_check THEN
    IF NEW.rain_check_moved_to IS NOT NULL THEN
      v_title := '🌧 ' || v_habit.display_name || ' moved ' || v_habit.title
                 || ' to ' || trim(to_char(NEW.rain_check_moved_to, 'FMDay'));
    ELSE
      v_title := '🌧 ' || v_habit.display_name || ' took a rain check on ' || v_habit.title;
    END IF;
    -- Prefer the user's own words; fall back to the chosen reason.
    v_body  := coalesce(
                 nullif(left(NEW.notes, 200), ''),
                 rain_check_reason_label(NEW.rain_check_reason)
               );
    v_type  := 'rain_check';
  ELSE
    v_title := coalesce(v_habit.emoji || ' ', '') || v_habit.display_name
               || ' completed ' || v_habit.title
               || CASE WHEN v_is_repeat THEN ' again' ELSE '' END;
    v_body  := 'Tap to see their progress!';
    v_type  := 'completion';
  END IF;

  FOR v_share IN
    SELECT hs.shared_with, p.notification_prefs, p.timezone
    FROM habit_shares hs
    JOIN profiles p ON p.id = hs.shared_with
    WHERE hs.habit_id = NEW.habit_id
      AND hs.status = 'accepted'
      AND hs.notify_complete = true
      AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = p.id)
      AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
      AND (p.notification_prefs->>'completion_alerts') IS DISTINCT FROM 'false'
  LOOP
    IF is_in_quiet_hours(v_share.notification_prefs, v_share.timezone) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'url', '/main/feed/' || NEW.user_id,
      'type', v_type,
      'user_id', v_share.shared_with
    );

    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := v_payload
    );
  END LOOP;

  RETURN NEW;
END;
$$;
