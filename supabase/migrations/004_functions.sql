-- ============================================================
-- 004_functions.sql — RPC functions
-- ============================================================

-- ── get_missed_habits (TIMESTAMPTZ overload) ──

CREATE OR REPLACE FUNCTION get_missed_habits(check_ts TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  user_id UUID,
  user_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT h.id, h.title, h.emoji, h.user_id, p.display_name AS user_name
  FROM public.habits h
  JOIN public.profiles p ON p.id = h.user_id
  WHERE h.is_paused = false
    AND h.is_shared = true
    AND (h.schedule->'days') @> to_jsonb(
      EXTRACT(DOW FROM check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::int
    )
    AND h.time_window IS NOT NULL
    AND (h.time_window->>'end') IS NOT NULL
    AND (h.time_window->>'end') < to_char(
      check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'), 'HH24:MI'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = (check_ts AT TIME ZONE coalesce(p.timezone, 'UTC'))::date
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── get_missed_habits (DATE, TEXT overload) ──

CREATE OR REPLACE FUNCTION get_missed_habits(check_date DATE, check_time TEXT)
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  user_id UUID,
  user_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM get_missed_habits(
    (check_date || 'T' || check_time || ':00Z')::timestamptz
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION get_missed_habits(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_missed_habits(TIMESTAMPTZ) FROM authenticated;
REVOKE ALL ON FUNCTION get_missed_habits(TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION get_missed_habits(TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION get_missed_habits(DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_missed_habits(DATE, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION get_missed_habits(DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION get_missed_habits(DATE, TEXT) TO service_role;

-- ── get_feed_friends (rate-limited, DISTINCT ON optimized) ──

CREATE OR REPLACE FUNCTION get_feed_friends(p_user_id UUID)
RETURNS TABLE (
  friend_id       UUID,
  display_name    TEXT,
  avatar_url      TEXT,
  username        TEXT,
  friendship_since TIMESTAMPTZ,
  shared_habits   JSONB,
  latest_completion JSONB,
  latest_encouragement JSONB
) AS $$
DECLARE
  v_recent INT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s feed data';
  END IF;

  SELECT count(*) INTO v_recent
  FROM feed_access_log
  WHERE user_id = auth.uid()
    AND accessed_at > now() - interval '1 minute';

  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many feed requests'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO feed_access_log (user_id) VALUES (auth.uid());

  RETURN QUERY
  WITH friends AS (
    SELECT
      CASE WHEN f.register_id = p_user_id THEN f.addressee_id ELSE f.register_id END AS fid,
      f.created_at AS since
    FROM friendships f
    WHERE (f.register_id = p_user_id OR f.addressee_id = p_user_id)
      AND f.status = 'accepted'
  ),
  shared AS (
    SELECT hs.habit_id, hs.shared_with AS fid
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_user_id
    WHERE hs.shared_with IN (SELECT fid FROM friends)
    UNION
    SELECT hs.habit_id, h.user_id AS fid
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id
    WHERE hs.shared_with = p_user_id
      AND h.user_id IN (SELECT fid FROM friends)
  ),
  friend_habits AS (
    SELECT
      s.fid,
      jsonb_agg(
        jsonb_build_object('emoji', coalesce(h.emoji, '✅'), 'title', h.title)
      ) AS habits_json
    FROM shared s
    JOIN habits h ON h.id = s.habit_id
    GROUP BY s.fid
  ),
  latest_completions AS (
    SELECT DISTINCT ON (s.fid)
      s.fid,
      jsonb_build_object(
        'habit_id', c.habit_id,
        'user_id', c.user_id,
        'completion_type', c.completion_type,
        'notes', c.notes,
        'completed_at', c.completed_at,
        'habit_emoji', coalesce(h.emoji, '✅'),
        'habit_title', h.title
      ) AS comp_json
    FROM shared s
    JOIN completions c ON c.habit_id = s.habit_id
      AND c.completed_at > now() - interval '30 days'
    JOIN habits h ON h.id = c.habit_id
    ORDER BY s.fid, c.completed_at DESC
  ),
  latest_encouragements AS (
    SELECT DISTINCT ON (sub.fid)
      sub.fid,
      jsonb_build_object(
        'encouragement_type', sub.encouragement_type,
        'content', sub.content,
        'created_at', sub.created_at,
        'user_id', sub.enc_user_id
      ) AS enc_json
    FROM (
      SELECT
        fr.fid,
        e.encouragement_type,
        e.content,
        e.created_at,
        e.user_id AS enc_user_id
      FROM friends fr
      JOIN encouragements e ON
        (e.user_id = p_user_id AND e.recipient_id = fr.fid)
        OR (e.user_id = fr.fid AND e.recipient_id = p_user_id)
      WHERE e.created_at > now() - interval '30 days'
    ) sub
    ORDER BY sub.fid, sub.created_at DESC
  )
  SELECT
    fr.fid AS friend_id,
    p.display_name,
    p.avatar_url,
    p.username,
    fr.since AS friendship_since,
    coalesce(fh.habits_json, '[]'::jsonb) AS shared_habits,
    lc.comp_json AS latest_completion,
    le.enc_json AS latest_encouragement
  FROM friends fr
  JOIN profiles p ON p.id = fr.fid
  LEFT JOIN friend_habits fh ON fh.fid = fr.fid
  LEFT JOIN latest_completions lc ON lc.fid = fr.fid
  LEFT JOIN latest_encouragements le ON le.fid = fr.fid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- ── insert_completion (with rate limit) ──

CREATE OR REPLACE FUNCTION insert_completion(
  p_habit_id UUID,
  p_completion_type completion_type,
  p_evidence_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion completions;
  v_recent_count INTEGER;
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

  INSERT INTO completions (habit_id, user_id, completion_type, evidence_url, notes)
  VALUES (p_habit_id, auth.uid(), p_completion_type, p_evidence_url, p_notes)
  RETURNING * INTO v_completion;

  RETURN v_completion;
END;
$$;

REVOKE ALL ON FUNCTION insert_completion(UUID, completion_type, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_completion(UUID, completion_type, TEXT, TEXT) TO authenticated;

-- ── insert_completions_batch (set-based ownership check) ──

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
    item->>'notes' AS notes
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
  INSERT INTO completions (habit_id, user_id, completion_type, evidence_url, notes)
  SELECT
    bi.habit_id,
    auth.uid(),
    bi.completion_type,
    bi.evidence_url,
    bi.notes
  FROM _batch_items bi
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION insert_completions_batch(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_completions_batch(JSONB) TO authenticated;

-- ── update_own_profile ──

CREATE OR REPLACE FUNCTION update_own_profile(
  p_display_name TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    avatar_url = COALESCE(p_avatar_url, avatar_url)
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION update_own_profile(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_own_profile(TEXT, TEXT) TO authenticated;

-- ── get_own_notification_settings ──

CREATE OR REPLACE FUNCTION public.get_own_notification_settings()
RETURNS TABLE (push_subscription JSONB, notification_prefs JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT push_subscription, notification_prefs
  FROM profiles
  WHERE id = auth.uid();
$$;

-- ── get_group_by_invite_code (rate-limited) ──

CREATE OR REPLACE FUNCTION get_group_by_invite_code(p_code TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_attempts INT;
BEGIN
  SELECT count(*) INTO recent_attempts
  FROM invite_code_attempts
  WHERE user_id = auth.uid()
    AND attempted_at > now() - interval '1 minute';

  IF recent_attempts >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many invite code lookups'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO invite_code_attempts (user_id) VALUES (auth.uid());

  RETURN QUERY
    SELECT g.id, g.name, g.description, g.avatar_url
    FROM groups g
    WHERE g.invite_code = p_code
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION get_group_by_invite_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_group_by_invite_code(TEXT) TO authenticated;

-- ── join_group_by_invite_code ──

CREATE OR REPLACE FUNCTION join_group_by_invite_code(p_code TEXT)
RETURNS TABLE (
  group_id UUID,
  group_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id UUID;
  v_group_name TEXT;
  v_user_id UUID := auth.uid();
  recent_attempts INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO recent_attempts
  FROM invite_code_attempts
  WHERE user_id = v_user_id
    AND attempted_at > now() - interval '1 minute';

  IF recent_attempts >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many invite code lookups'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO invite_code_attempts (user_id) VALUES (v_user_id);

  SELECT g.id, g.name INTO v_group_id, v_group_name
  FROM groups g
  WHERE g.invite_code = p_code
  LIMIT 1;

  IF v_group_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.group_id = v_group_id AND gm.user_id = v_user_id
  ) THEN
    group_id := v_group_id;
    group_name := v_group_name;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO group_members (group_id, user_id, role)
  VALUES (v_group_id, v_user_id, 'member');

  group_id := v_group_id;
  group_name := v_group_name;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION join_group_by_invite_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_group_by_invite_code(TEXT) TO authenticated;

-- ── create_group ──

CREATE OR REPLACE FUNCTION create_group(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL,
  p_invite_code TEXT DEFAULT NULL,
  p_initial_member_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  avatar_url TEXT,
  invite_code TEXT,
  settings JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_group_id UUID;
  v_member_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO groups (name, description, avatar_url, created_by, invite_code)
  VALUES (p_name, p_description, p_avatar_url, v_user_id, p_invite_code)
  RETURNING groups.id INTO v_group_id;

  INSERT INTO group_members (group_id, user_id, role)
  VALUES (v_group_id, v_user_id, 'admin');

  IF array_length(p_initial_member_ids, 1) IS NOT NULL THEN
    INSERT INTO group_members (group_id, user_id, role)
    SELECT v_group_id, uid, 'member'
    FROM unnest(p_initial_member_ids) AS uid
    WHERE uid != v_user_id;
  END IF;

  RETURN QUERY
    SELECT g.id, g.name, g.description, g.avatar_url, g.invite_code,
           g.settings, g.created_by, g.created_at, g.updated_at
    FROM groups g
    WHERE g.id = v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION create_group(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_group(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;

-- ── reset_stale_streaks (service_role only, called by cron) ──

CREATE OR REPLACE FUNCTION public.reset_stale_streaks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  WITH stale AS (
    SELECT h.id AS habit_id
    FROM habits h
    JOIN profiles p ON p.id = h.user_id
    WHERE h.streak_current > 0
      AND h.is_paused = false
      AND NOT EXISTS (
        SELECT 1 FROM completions c
        WHERE c.habit_id = h.id
          AND c.completed_date >= (
            (now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::date - 1
          )
      )
      AND (
        (h.schedule->'days') @> to_jsonb(
          EXTRACT(DOW FROM now() AT TIME ZONE coalesce(p.timezone, 'UTC'))::int
        )
        OR (h.schedule->'days') @> to_jsonb(
          EXTRACT(DOW FROM (now() AT TIME ZONE coalesce(p.timezone, 'UTC') - interval '1 day'))::int
        )
      )
  )
  UPDATE habits
  SET streak_current = 0
  FROM stale
  WHERE habits.id = stale.habit_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION reset_stale_streaks() FROM PUBLIC;
REVOKE ALL ON FUNCTION reset_stale_streaks() FROM authenticated;
REVOKE ALL ON FUNCTION reset_stale_streaks() FROM anon;
GRANT EXECUTE ON FUNCTION reset_stale_streaks() TO service_role;

-- ── get_missed_habit_count ──

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
  v_count INTEGER;
BEGIN
  v_today_dow := EXTRACT(DOW FROM now() AT TIME ZONE p_timezone)::int;
  v_today_date := (now() AT TIME ZONE p_timezone)::date;

  SELECT count(*)::int INTO v_count
  FROM habit_shares hs
  JOIN habits h ON h.id = hs.habit_id
  WHERE hs.shared_with = auth.uid()
    AND h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(v_today_dow)
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

-- ── get_incomplete_habits_today ──

CREATE OR REPLACE FUNCTION get_incomplete_habits_today(p_timezone TEXT DEFAULT 'UTC')
RETURNS TABLE (
  id UUID,
  title TEXT,
  emoji TEXT,
  color TEXT,
  streak_current INTEGER
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
    coalesce(h.emoji, '✅') AS emoji,
    coalesce(h.color, '#6366F1') AS color,
    coalesce(h.streak_current, 0) AS streak_current
  FROM habits h
  WHERE h.user_id = auth.uid()
    AND h.is_paused = false
    AND (h.schedule->'days') @> to_jsonb(v_today_dow)
    AND NOT EXISTS (
      SELECT 1 FROM completions c
      WHERE c.habit_id = h.id
        AND c.completed_date = v_today_date
    )
  ORDER BY h.created_at;
END;
$$;

REVOKE ALL ON FUNCTION get_incomplete_habits_today(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incomplete_habits_today(TEXT) TO authenticated;

-- ── get_user_groups ──

CREATE OR REPLACE FUNCTION public.get_user_groups(p_user_id uuid)
RETURNS TABLE (
  id           uuid,
  name         text,
  description  text,
  avatar_url   text,
  invite_code  text,
  settings     jsonb,
  created_by   uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  my_role      text,
  member_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    g.id,
    g.name,
    g.description,
    g.avatar_url,
    g.invite_code,
    g.settings,
    g.created_by,
    g.created_at,
    g.updated_at,
    my.role        AS my_role,
    cnt.member_count
  FROM public.group_members my
  JOIN public.groups g ON g.id = my.group_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS member_count
    FROM public.group_members gm
    WHERE gm.group_id = g.id
  ) cnt ON true
  WHERE my.user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_groups(uuid) TO authenticated;

-- ── search_profiles (rate-limited) ──

CREATE OR REPLACE FUNCTION search_profiles(p_query TEXT)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent INT;
  v_safe_query TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_query IS NULL OR char_length(p_query) < 2 OR char_length(p_query) > 100 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent
  FROM profile_search_log
  WHERE user_id = auth.uid()
    AND searched_at > now() - interval '1 minute';

  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many searches'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO profile_search_log (user_id) VALUES (auth.uid());

  v_safe_query := replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN QUERY
    SELECT p.id, p.display_name, p.username, p.avatar_url
    FROM profiles p
    WHERE p.id != auth.uid()
      AND p.username ILIKE v_safe_query || '%' ESCAPE '\'
    ORDER BY p.username
    LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION search_profiles(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_profiles(TEXT) TO authenticated;

-- ── get_inbox_missed_habits ──

CREATE OR REPLACE FUNCTION public.get_inbox_missed_habits(
  p_user_id UUID,
  p_today_date DATE,
  p_day_of_week INT,
  p_day_start TIMESTAMPTZ,
  p_day_end   TIMESTAMPTZ
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
    AND NOT EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.habit_id = h.id
        AND c.completed_at >= p_day_start
        AND c.completed_at <  p_day_end
    );
$$;
