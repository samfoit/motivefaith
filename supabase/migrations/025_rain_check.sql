-- ============================================================
-- 025_rain_check.sql — reason column, streak semantics, push copy
-- ============================================================
--
-- Builds on 024, which added the 'rain_check' value to completion_type.
--
-- Semantics: a rain check HOLDS the streak. It does not advance
-- streak_current or streak_best, and it never counts toward
-- total_completions. The row's mere existence is what preserves the
-- streak, because reset_stale_streaks(), computeEffectiveStreak() (TS)
-- and update_streak()'s prev_completion lookup all treat "a row exists
-- on this date" as "this day is covered". Those three are deliberately
-- left unchanged.

-- ── Reason enum + column ──

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rain_check_reason') THEN
    CREATE TYPE rain_check_reason AS ENUM ('sick', 'travel', 'rest', 'busy', 'other');
  END IF;
END
$$;

ALTER TABLE public.completions
  ADD COLUMN IF NOT EXISTS rain_check_reason rain_check_reason;

ALTER TABLE public.completions
  DROP CONSTRAINT IF EXISTS chk_rain_check_reason;

ALTER TABLE public.completions
  ADD CONSTRAINT chk_rain_check_reason
    CHECK (rain_check_reason IS NULL OR completion_type = 'rain_check');

-- ── Reason → prose, shared by the push trigger ──
-- Mirrors RAIN_CHECK_REASON_LABELS in src/lib/constants/rain-check.ts.

CREATE OR REPLACE FUNCTION public.rain_check_reason_label(r rain_check_reason)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE r
    WHEN 'sick'   THEN 'Feeling unwell'
    WHEN 'travel' THEN 'Travelling'
    WHEN 'rest'   THEN 'Taking a rest day'
    WHEN 'busy'   THEN 'Busy day'
    WHEN 'other'  THEN 'No reason given'
    ELSE 'No reason given'
  END;
$$;

-- ── insert_completion: new rain_check_reason parameter ──
-- Adding a defaulted 5th parameter creates an OVERLOAD rather than
-- replacing the function, which makes every existing 4-argument call
-- ambiguous. Drop the old signature first; the grants go with it.

DROP FUNCTION IF EXISTS insert_completion(UUID, completion_type, TEXT, TEXT);

CREATE OR REPLACE FUNCTION insert_completion(
  p_habit_id UUID,
  p_completion_type completion_type,
  p_evidence_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_rain_check_reason rain_check_reason DEFAULT NULL
)
RETURNS completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion completions;
  v_recent_count INTEGER;
  v_reason rain_check_reason;
BEGIN
  SELECT count(*)::int INTO v_recent_count
  FROM completions
  WHERE user_id = auth.uid()
    AND completed_at > now() - interval '60 seconds';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded'
      USING ERRCODE = '54000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM habits
    WHERE id = p_habit_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Habit not found or not owned'
      USING ERRCODE = '42501';
  END IF;

  -- Ignore a reason sent alongside a non-rain-check type rather than
  -- letting a malformed client trip chk_rain_check_reason.
  v_reason := CASE WHEN p_completion_type = 'rain_check'
                   THEN p_rain_check_reason
                   ELSE NULL END;

  INSERT INTO completions (habit_id, user_id, completion_type, evidence_url, notes, rain_check_reason)
  VALUES (p_habit_id, auth.uid(), p_completion_type, p_evidence_url, p_notes, v_reason)
  RETURNING * INTO v_completion;

  RETURN v_completion;
END;
$$;

REVOKE ALL ON FUNCTION insert_completion(UUID, completion_type, TEXT, TEXT, rain_check_reason) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_completion(UUID, completion_type, TEXT, TEXT, rain_check_reason) TO authenticated;

-- ── insert_completions_batch: carry the reason through ──

CREATE OR REPLACE FUNCTION insert_completions_batch(
  p_items JSONB
)
RETURNS SETOF completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bad_id UUID;
BEGIN
  CREATE TEMP TABLE _batch_items ON COMMIT DROP AS
  SELECT
    (item->>'habit_id')::UUID AS habit_id,
    (item->>'completion_type')::completion_type AS completion_type,
    item->>'evidence_url' AS evidence_url,
    item->>'notes' AS notes,
    CASE WHEN (item->>'completion_type')::completion_type = 'rain_check'
         THEN NULLIF(item->>'rain_check_reason', '')::rain_check_reason
         ELSE NULL END AS rain_check_reason
  FROM jsonb_array_elements(p_items) AS item;

  SELECT bi.habit_id INTO v_bad_id
  FROM _batch_items bi
  WHERE NOT EXISTS (
    SELECT 1 FROM habits h
    WHERE h.id = bi.habit_id AND h.user_id = auth.uid()
  )
  LIMIT 1;

  IF v_bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'Habit % not found or not owned', v_bad_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO completions (habit_id, user_id, completion_type, evidence_url, notes, rain_check_reason)
  SELECT
    bi.habit_id,
    auth.uid(),
    bi.completion_type,
    bi.evidence_url,
    bi.notes,
    bi.rain_check_reason
  FROM _batch_items bi
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION insert_completions_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_completions_batch(JSONB) TO authenticated;

-- ── update_streak: rain checks hold the streak ──
-- Based on the body in 012_fix_streak_custom_schedules.sql. Two changes:
--   1. Early return for rain checks — no streak_current, streak_best or
--      total_completions movement. A skip is not a completion.
--   2. The "already counted" guards now ignore rain-check rows. Without
--      this, a rain check taken in the morning would make a genuine
--      evening check-in a no-op for the streak.
-- prev_completion is deliberately left seeing rain-check rows: that is
-- exactly what bridges the gap to the next real completion.

CREATE OR REPLACE FUNCTION update_streak()
RETURNS TRIGGER AS $$
DECLARE
  prev_completion   DATE;
  cur_streak        INT;
  sched_days        JSONB;
  freq              TEXT;
  check_date        DATE;
  check_dow         INT;
  expected_prev     DATE := NULL;
  week_start        DATE;
  prev_week_start   DATE;
  already_counted   BOOLEAN;
BEGIN
  -- A rain check preserves the streak by existing, and changes nothing else.
  IF NEW.completion_type = 'rain_check' THEN
    RETURN NEW;
  END IF;

  SELECT streak_current, schedule->'days', frequency::text
    INTO cur_streak, sched_days, freq
    FROM public.habits
    WHERE id = NEW.habit_id
    FOR UPDATE;

  SELECT MAX(c.completed_date) INTO prev_completion
    FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date < NEW.completed_date;

  -- ── Weekly frequency: streak = consecutive weeks with a completion ──
  IF freq = 'weekly' THEN
    -- Week starts on Sunday (DOW 0)
    week_start := NEW.completed_date - EXTRACT(DOW FROM NEW.completed_date)::int;
    prev_week_start := week_start - 7;

    -- Check if this week already had a real completion before this one
    SELECT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = NEW.habit_id
        AND c.completed_date >= week_start
        AND c.completion_type <> 'rain_check'
        AND c.id != NEW.id
    ) INTO already_counted;

    IF already_counted THEN
      -- Duplicate this week: just bump total, don't change streak
      UPDATE public.habits SET
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    ELSIF prev_completion IS NOT NULL
          AND prev_completion >= prev_week_start THEN
      -- Previous completion was last week: streak continues
      UPDATE public.habits SET
        streak_current    = cur_streak + 1,
        streak_best       = GREATEST(streak_best, cur_streak + 1),
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    ELSE
      -- No completion last week: start new streak
      UPDATE public.habits SET
        streak_current    = 1,
        streak_best       = GREATEST(streak_best, 1),
        total_completions = total_completions + 1
      WHERE id = NEW.habit_id;
    END IF;

    RETURN NEW;
  END IF;

  -- ── Daily-type frequencies ──

  -- Guard: if this date already has another real completion, just bump total.
  -- Prevents duplicate same-day completions from resetting the streak.
  -- Rain checks are excluded so that rain-checking in the morning and then
  -- actually doing the habit in the evening still advances the streak.
  SELECT EXISTS (
    SELECT 1 FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date = NEW.completed_date
      AND c.completion_type <> 'rain_check'
      AND c.id != NEW.id
  ) INTO already_counted;

  IF already_counted THEN
    UPDATE public.habits SET
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
    RETURN NEW;
  END IF;

  -- Walk backward from the day before this completion to find
  -- the most recent scheduled day (up to 14 days back).
  check_date := NEW.completed_date - 1;
  FOR i IN 1..14 LOOP
    check_dow := EXTRACT(DOW FROM check_date)::int;

    IF sched_days IS NULL
       OR jsonb_array_length(sched_days) = 0
       OR sched_days @> to_jsonb(check_dow) THEN
      expected_prev := check_date;
      EXIT;
    END IF;

    check_date := check_date - 1;
  END LOOP;

  -- Use >= so that completions on non-scheduled (off) days between
  -- two scheduled days don't break the streak. E.g. a Mon-Fri habit
  -- completed on Saturday: on Monday, prev_completion = Saturday,
  -- expected_prev = Friday. Saturday >= Friday → streak continues.
  IF prev_completion IS NOT NULL
     AND expected_prev IS NOT NULL
     AND prev_completion >= expected_prev THEN
    UPDATE public.habits SET
      streak_current    = cur_streak + 1,
      streak_best       = GREATEST(streak_best, cur_streak + 1),
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
  ELSE
    UPDATE public.habits SET
      streak_current    = 1,
      streak_best       = GREATEST(streak_best, 1),
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql SET search_path = public;

-- ── notify_completion: distinct copy for rain checks ──
-- Same fan-out (habit_shares.notify_complete), same completion_alerts
-- preference gate, same quiet-hours check — only the payload differs.
-- 'rain_check' becomes a new push type, which the service worker uses as
-- the notification tag, so rain checks coalesce separately from check-ins.

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

  IF v_is_rain_check THEN
    v_title := '🌧 ' || v_habit.display_name || ' took a rain check on ' || v_habit.title;
    -- Prefer the user's own words; fall back to the chosen reason.
    v_body  := coalesce(
                 nullif(left(NEW.notes, 200), ''),
                 rain_check_reason_label(NEW.rain_check_reason)
               );
    v_type  := 'rain_check';
  ELSE
    v_title := v_habit.emoji || ' ' || v_habit.display_name || ' completed ' || v_habit.title;
    v_body  := 'Tap to see their progress!';
    v_type  := 'completion';
  END IF;

  FOR v_share IN
    SELECT hs.shared_with, p.push_subscription, p.notification_prefs, p.timezone
    FROM habit_shares hs
    JOIN profiles p ON p.id = hs.shared_with
    WHERE hs.habit_id = NEW.habit_id
      AND hs.notify_complete = true
      AND p.push_subscription IS NOT NULL
      AND (p.notification_prefs->>'enabled') IS DISTINCT FROM 'false'
      AND (p.notification_prefs->>'completion_alerts') IS DISTINCT FROM 'false'
  LOOP
    IF is_in_quiet_hours(v_share.notification_prefs, v_share.timezone) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'subscription', v_share.push_subscription,
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

-- ── get_feed_groups_latest_completions: expose completion_type ──
-- The group feed preview needs to tell "completed" from "took a rain check".
-- Changing the RETURNS TABLE shape requires dropping the function first.

DROP FUNCTION IF EXISTS get_feed_groups_latest_completions(UUID, UUID[]);

CREATE OR REPLACE FUNCTION get_feed_groups_latest_completions(
  p_user_id UUID,
  p_group_ids UUID[]
)
RETURNS TABLE (
  group_id        UUID,
  user_id         UUID,
  completed_at    TIMESTAMPTZ,
  completion_type completion_type,
  habit_emoji     TEXT,
  habit_title     TEXT,
  user_name       TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s feed data';
  END IF;

  RETURN QUERY
  WITH my_groups AS (
    SELECT gm.group_id
    FROM group_members gm
    WHERE gm.user_id = p_user_id
      AND gm.group_id = ANY(p_group_ids)
  )
  SELECT DISTINCT ON (ghs.group_id)
    ghs.group_id,
    c.user_id,
    c.completed_at,
    c.completion_type,
    coalesce(h.emoji, '✅') AS habit_emoji,
    h.title AS habit_title,
    coalesce(p.display_name, 'Someone') AS user_name
  FROM group_habit_shares ghs
  JOIN my_groups mg ON mg.group_id = ghs.group_id
  JOIN completions c ON c.habit_id = ghs.habit_id
    AND c.completed_at > now() - interval '30 days'
  JOIN habits h ON h.id = c.habit_id
  LEFT JOIN profiles p ON p.id = c.user_id
  ORDER BY ghs.group_id, c.completed_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_feed_groups_latest_completions(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_feed_groups_latest_completions(UUID, UUID[]) TO authenticated;

-- ── Journey + group timeline RPCs: carry rain_check_reason ──
-- Both return JSONB payloads, so the signature is unchanged; the bodies are
-- reproduced from migrations 016 and 017 with the reason threaded through.

-- (from 016)
CREATE OR REPLACE FUNCTION get_friend_journey(p_user_id UUID, p_friend_id UUID)
RETURNS TABLE (
  habits          JSONB,
  completions     JSONB,
  encouragements  JSONB,
  user_timezone   TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s journey data';
  END IF;

  RETURN QUERY
  WITH shared AS (
    -- Direction A: my habits shared with friend
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_user_id
    WHERE hs.shared_with = p_friend_id
    UNION
    -- Direction B: friend's habits shared with me
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_friend_id
    WHERE hs.shared_with = p_user_id
  ),
  habit_details AS (
    SELECT
      h.id,
      h.title,
      coalesce(h.emoji, '✅') AS emoji,
      coalesce(h.color, '#6366F1') AS color,
      h.user_id AS owner_id,
      coalesce(h.streak_current, 0) AS streak_current,
      coalesce(h.streak_best, 0) AS streak_best,
      (h.user_id = p_user_id) AS is_owner
    FROM shared s
    JOIN habits h ON h.id = s.habit_id
  ),
  viewer_tz AS (
    SELECT coalesce(p.timezone, 'UTC') AS tz
    FROM profiles p
    WHERE p.id = p_user_id
  ),
  today_local AS (
    SELECT (now() AT TIME ZONE (SELECT tz FROM viewer_tz))::date AS d
  ),
  completions_30d AS (
    SELECT
      c.id,
      c.habit_id,
      c.user_id,
      c.completion_type,
      c.rain_check_reason,
      c.evidence_url,
      c.notes,
      c.completed_at,
      c.completed_date
    FROM completions c
    WHERE c.habit_id IN (SELECT hd.id FROM habit_details hd)
      AND c.user_id IN (p_user_id, p_friend_id)
      AND c.completed_at > now() - interval '30 days'
    ORDER BY c.completed_at DESC
    LIMIT 500
  ),
  enc AS (
    SELECT
      e.id,
      e.user_id,
      e.encouragement_type,
      e.content,
      e.created_at,
      e.completion_id
    FROM encouragements e
    WHERE (
      (e.user_id = p_user_id AND e.recipient_id = p_friend_id)
      OR (e.user_id = p_friend_id AND e.recipient_id = p_user_id)
    )
    ORDER BY e.created_at DESC
    LIMIT 30
  )
  SELECT
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', hd.id,
        'title', hd.title,
        'emoji', hd.emoji,
        'color', hd.color,
        'owner_id', hd.owner_id,
        'streak_current', hd.streak_current,
        'streak_best', hd.streak_best,
        'is_owner', hd.is_owner,
        'completed_today', EXISTS (
          SELECT 1 FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type IS DISTINCT FROM 'rain_check'
        ),
        'rain_checked_today', EXISTS (
          SELECT 1 FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type = 'rain_check'
        )
      ) ORDER BY hd.title) FROM habit_details hd),
      '[]'::jsonb
    ),

    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'habit_id', c.habit_id,
        'user_id', c.user_id,
        'completion_type', coalesce(c.completion_type, 'quick'),
        'rain_check_reason', c.rain_check_reason,
        'evidence_url', c.evidence_url,
        'notes', c.notes,
        'completed_at', c.completed_at,
        'habit_emoji', hd.emoji,
        'habit_title', hd.title,
        'habit_color', hd.color
      ) ORDER BY c.completed_at DESC)
      FROM completions_30d c
      JOIN habit_details hd ON hd.id = c.habit_id),
      '[]'::jsonb
    ),

    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'user_id', e.user_id,
        'encouragement_type', coalesce(e.encouragement_type, 'nudge'),
        'content', e.content,
        'created_at', e.created_at,
        'completion_id', e.completion_id
      ) ORDER BY e.created_at DESC)
      FROM enc e),
      '[]'::jsonb
    ),

    (SELECT tz FROM viewer_tz);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_friend_journey(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_friend_journey(UUID, UUID) TO authenticated;

-- (from 017)
CREATE OR REPLACE FUNCTION get_group_timeline_activity(
  p_group_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  habits        JSONB,
  completions   JSONB,
  user_timezone TEXT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s group data';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Forbidden: user is not a member of this group'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  WITH shared_habit_ids AS (
    SELECT ghs.habit_id
    FROM group_habit_shares ghs
    WHERE ghs.group_id = p_group_id
  ),
  challenge_habit_ids AS (
    SELECT DISTINCT gcp.habit_id
    FROM group_challenge_participants gcp
    JOIN group_challenges gc ON gc.id = gcp.challenge_id
    WHERE gc.group_id = p_group_id
      AND gc.is_active = true
      AND gcp.habit_id IS NOT NULL
  ),
  all_habit_ids AS (
    SELECT habit_id FROM shared_habit_ids
    UNION
    SELECT habit_id FROM challenge_habit_ids
  ),
  habit_details AS (
    SELECT
      h.id,
      h.title,
      coalesce(h.emoji, '✅') AS emoji,
      coalesce(h.color, '#6366F1') AS color,
      coalesce(h.category, 'general') AS category,
      coalesce(h.streak_current, 0) AS streak_current,
      h.user_id AS owner_id,
      coalesce(p.display_name, 'Unknown') AS owner_name,
      p.avatar_url AS owner_avatar,
      EXISTS (
        SELECT 1 FROM shared_habit_ids shi WHERE shi.habit_id = h.id
      ) AS is_shared
    FROM all_habit_ids ahi
    JOIN habits h ON h.id = ahi.habit_id
    LEFT JOIN profiles p ON p.id = h.user_id
  ),
  viewer_tz AS (
    SELECT coalesce(p.timezone, 'UTC') AS tz
    FROM profiles p
    WHERE p.id = p_user_id
  ),
  today_local AS (
    SELECT (now() AT TIME ZONE (SELECT tz FROM viewer_tz))::date AS d
  ),
  completions_30d AS (
    SELECT
      c.id,
      c.habit_id,
      c.user_id,
      c.completion_type,
      c.rain_check_reason,
      c.evidence_url,
      c.notes,
      c.completed_at,
      c.completed_date
    FROM completions c
    WHERE c.habit_id IN (SELECT habit_id FROM all_habit_ids)
      AND c.completed_at > now() - interval '30 days'
    ORDER BY c.completed_at DESC
    LIMIT 100
  ),
  completion_reactions AS (
    SELECT
      gcr.completion_id,
      jsonb_agg(jsonb_build_object(
        'id', gcr.id,
        'user_id', gcr.user_id,
        'emoji', gcr.emoji
      )) AS reactions
    FROM group_completion_reactions gcr
    WHERE gcr.completion_id IN (SELECT id FROM completions_30d)
    GROUP BY gcr.completion_id
  )
  SELECT
    -- habits: only those from group_habit_shares (matching current page behavior)
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', hd.id,
        'title', hd.title,
        'emoji', hd.emoji,
        'color', hd.color,
        'category', hd.category,
        'streak_current', hd.streak_current,
        'owner_id', hd.owner_id,
        'owner_name', hd.owner_name,
        'owner_avatar', hd.owner_avatar,
        'completed_today', EXISTS (
          SELECT 1 FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type IS DISTINCT FROM 'rain_check'
        ),
        'rain_checked_today', EXISTS (
          SELECT 1 FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type = 'rain_check'
        )
      ) ORDER BY hd.title)
      FROM habit_details hd
      WHERE hd.is_shared = true),
      '[]'::jsonb
    ),

    -- completions: all habits (shared + challenge), with user/habit info + reactions
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'habit_id', c.habit_id,
        'user_id', c.user_id,
        'completion_type', coalesce(c.completion_type, 'quick'),
        'rain_check_reason', c.rain_check_reason,
        'evidence_url', c.evidence_url,
        'notes', c.notes,
        'completed_at', c.completed_at,
        'user_name', coalesce(p.display_name, 'Unknown'),
        'user_avatar', p.avatar_url,
        'habit_emoji', hd.emoji,
        'habit_title', hd.title,
        'habit_color', hd.color,
        'reactions', coalesce(cr.reactions, '[]'::jsonb)
      ) ORDER BY c.completed_at DESC)
      FROM completions_30d c
      JOIN habit_details hd ON hd.id = c.habit_id
      LEFT JOIN profiles p ON p.id = c.user_id
      LEFT JOIN completion_reactions cr ON cr.completion_id = c.id),
      '[]'::jsonb
    ),

    (SELECT tz FROM viewer_tz);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION get_group_timeline_activity(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_group_timeline_activity(UUID, UUID) TO authenticated;
