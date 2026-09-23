-- ============================================================
-- 029_habit_visibility.sql — habits get a visibility mode, and
-- accountability partnership becomes a two-sided handshake
-- ============================================================
--
-- Two things were conflated before this migration.
--
--   habits.is_shared   a boolean the create wizard wrote and exactly one live
--                      function read (get_missed_habits). Adding a partner from
--                      the habit detail page never set it, so those partners
--                      silently got no miss alerts.
--
--   habit_shares       a row whose mere existence granted read access to the
--                      habit, its completions and its evidence media. The owner
--                      inserted it unilaterally; the other person found out by
--                      being notified.
--
-- They are pulled apart into two independent axes:
--
--   habits.visibility    governs DISCOVERY. 'public' means accepted friends can
--                        see the habit exists on your profile and ask to join.
--                        'private' means nobody can find it. Neither says
--                        anything about who can see the streak.
--
--   habit_shares.status  governs ACCESS, and only 'accepted' grants anything.
--                        A private habit can have as many partners as it likes —
--                        they just have to be invited, because nobody can
--                        stumble across it.
--
-- Partnership is now a handshake from whichever end starts it:
--
--   owner invites friend  -> pending (initiated_by = owner)   -> friend answers
--   friend asks to join   -> pending (initiated_by = friend)  -> owner answers
--
-- One row, one state machine. initiated_by says whose inbox it belongs in and,
-- by elimination, who is allowed to answer it.
--
-- The load-bearing half of this migration is section 7: every place that used to
-- mean "a habit_shares row exists" must come to mean "an ACCEPTED habit_shares
-- row exists". Miss one and a pending invitee — someone who has affirmatively
-- not agreed to anything — keeps full sight of another person's evidence
-- photos, which is the exact failure this feature exists to prevent.

-- ── 1. Enums ──

DO $$ BEGIN
  CREATE TYPE habit_visibility AS ENUM ('public', 'private');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE habit_partner_status AS ENUM ('pending', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Columns ──

-- Private is the default for new habits as well as old ones: discoverability is
-- something you opt into, never something a migration does to you.
ALTER TABLE public.habits
  ADD COLUMN IF NOT EXISTS visibility habit_visibility NOT NULL DEFAULT 'private';

-- status lands as 'accepted' so the backfill below is a no-op for existing rows;
-- section 4 then moves the default to 'pending', which is the safe default for
-- anything inserted afterwards.
ALTER TABLE public.habit_shares
  ADD COLUMN IF NOT EXISTS status habit_partner_status NOT NULL DEFAULT 'accepted';

-- ON DELETE SET NULL rather than a plain reference: delete_own_account (023)
-- clears habit_shares by shared_with and lets the habits cascade take the rest,
-- which already covers every row this column can point at. The SET NULL is
-- insurance against a future flow that initiates a partnership from some third
-- party, so account deletion can never wedge on this FK.
ALTER TABLE public.habit_shares
  ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.habit_shares
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- ── 3. Backfill ──

-- Every habit that exists today becomes private. Some of them are shared with
-- friends or groups, but sharing was never a statement about discoverability,
-- and inferring consent to be listed on a profile from a share made under the
-- old model would be putting words in people's mouths.
UPDATE public.habits SET visibility = 'private';

-- Existing partnerships are grandfathered in as accepted — they are working
-- relationships and re-asking everyone would be worse than pointless. The owner
-- is recorded as the initiator because, under the old model, they always were.
UPDATE public.habit_shares hs
SET status       = 'accepted',
    initiated_by = h.user_id,
    responded_at = hs.created_at
FROM public.habits h
WHERE h.id = hs.habit_id;

-- ── 4. The safe default, now that the backfill is done ──

ALTER TABLE public.habit_shares ALTER COLUMN status SET DEFAULT 'pending';

-- ── 5. Indexes ──

-- Discovery: a friend's public habits, on their profile.
CREATE INDEX IF NOT EXISTS idx_habits_public
  ON public.habits (user_id)
  WHERE visibility = 'public' AND is_paused = false;

-- The two inbox queries: invites and requests addressed to me, and the pending
-- traffic on one of my habits.
CREATE INDEX IF NOT EXISTS idx_habit_shares_incoming
  ON public.habit_shares (shared_with, status);

CREATE INDEX IF NOT EXISTS idx_habit_shares_habit_status
  ON public.habit_shares (habit_id, status);

-- ── 6. Helpers ──

-- The single definition of "may see this habit's private detail". Every read
-- path in section 7 goes through this or spells out the same predicate, so the
-- rule cannot drift apart across a dozen call sites.
CREATE OR REPLACE FUNCTION public.is_accepted_partner(
  h_id UUID,
  u_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM habit_shares
    WHERE habit_id = h_id
      AND shared_with = u_id
      AND status = 'accepted'
  );
$$;

REVOKE ALL ON FUNCTION public.is_accepted_partner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_accepted_partner(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.are_friends(a_id UUID, b_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM friendships f
    WHERE f.status = 'accepted'
      AND (
        (f.register_id = a_id AND f.addressee_id = b_id)
        OR (f.register_id = b_id AND f.addressee_id = a_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;

-- ── 7. The read-path sweep ──
--
-- Everything below this line used to key off the existence of a habit_shares
-- row. Each now requires status = 'accepted'.

-- 7a. RLS: habits (was 002_rls_policies.sql "Shared habits readable")

DROP POLICY IF EXISTS "Shared habits readable" ON public.habits;

CREATE POLICY "Shared habits readable"
  ON public.habits FOR SELECT USING (
    public.is_accepted_partner(habits.id)
  );

-- 7b. RLS: completions (was 002_rls_policies.sql "Shared completions readable")

DROP POLICY IF EXISTS "Shared completions readable" ON public.completions;

CREATE POLICY "Shared completions readable"
  ON public.completions FOR SELECT USING (
    public.is_accepted_partner(completions.habit_id)
  );

-- 7c. RLS: storage (was 005_storage.sql "Users read own or shared completions")
--
-- The easiest one to overlook and the worst to get wrong: this is what gates
-- completion photos, video and voice notes. The habit id is compared as text
-- rather than cast to uuid, exactly as before — a path segment that is not a
-- uuid must fail the comparison, not raise.

DROP POLICY IF EXISTS "Users read own or shared completions" ON storage.objects;

CREATE POLICY "Users read own or shared completions"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'completions'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.habit_shares hs
        WHERE hs.shared_with = auth.uid()
          AND hs.status = 'accepted'
          AND hs.habit_id::text = (storage.foldername(name))[2]
      )
    )
  );

-- 7d. RLS: habit_shares itself
--
-- Deliberately NOT filtered by status. A pending invitee has to be able to read
-- the row addressed to them, or they could never answer it. The row carries no
-- habit detail on its own; what it grants access to is governed by 7a-7c.
-- (Left exactly as 002 wrote it; restated here so the omission reads as a
-- decision rather than an oversight.)

-- 7e. A partner can now leave.
--
-- Under the old model only the owner could delete a share, which made sense
-- when the owner had unilaterally created it. Under a handshake, the person who
-- agreed to watch must be able to stop.

DROP POLICY IF EXISTS "Partner can remove themselves" ON public.habit_shares;

CREATE POLICY "Partner can remove themselves"
  ON public.habit_shares FOR DELETE
  USING (shared_with = auth.uid());

-- 7f. Lock the state machine.
--
-- Every transition goes through the SECURITY DEFINER functions in section 9,
-- which own the rules about who may invite, who may request and who may answer.
-- Direct INSERT and UPDATE would let a client write status = 'accepted' for
-- itself, so the client does not get to hold that pen at all.
--
-- SELECT and DELETE stay with the policies above: reading your own rows, and
-- leaving or revoking, are both safe to express as policies.

REVOKE INSERT, UPDATE ON public.habit_shares FROM authenticated;
REVOKE INSERT, UPDATE ON public.habit_shares FROM anon;

-- 7g. get_missed_habits — and the end of is_shared.
--
-- Body from 004_functions.sql with `h.is_shared = true` replaced by the
-- accepted-partner test it was always standing in for. This is what fixes the
-- bug where a partner added from the habit detail page got no miss alerts: that
-- path inserted a habit_shares row and never touched is_shared, so the habit
-- failed this filter and nobody was told.

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
    AND EXISTS (
      SELECT 1 FROM public.habit_shares hs
      WHERE hs.habit_id = h.id AND hs.status = 'accepted'
    )
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

-- 7h. get_missed_habit_count / get_inbox_missed_habits (bodies from 018)

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
    AND hs.status = 'accepted'
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

-- 7i. get_feed_friends (body from 014_feed_exclude_own_completions.sql)

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
      AND hs.status = 'accepted'
    UNION
    SELECT hs.habit_id, h.user_id AS fid
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id
    WHERE hs.shared_with = p_user_id
      AND hs.status = 'accepted'
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
      AND c.user_id != p_user_id
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

-- 7j. get_friend_journey (body from 027_rain_check_move.sql)
--
-- Only the `shared` CTE changes: both directions now require an accepted row.

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
    -- Direction A: my habits this friend has accepted a partnership on
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_user_id
    WHERE hs.shared_with = p_friend_id
      AND hs.status = 'accepted'
    UNION
    -- Direction B: their habits I have accepted a partnership on
    SELECT hs.habit_id
    FROM habit_shares hs
    JOIN habits h ON h.id = hs.habit_id AND h.user_id = p_friend_id
    WHERE hs.shared_with = p_user_id
      AND hs.status = 'accepted'
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
      c.rain_check_moved_to,
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
        ),
        'rain_check_moved_to', (
          SELECT c2.rain_check_moved_to FROM completions_30d c2
          WHERE c2.habit_id = hd.id
            AND c2.user_id = hd.owner_id
            AND c2.completed_date = (SELECT d FROM today_local)
            AND c2.completion_type = 'rain_check'
          LIMIT 1
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
        'rain_check_moved_to', c.rain_check_moved_to,
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

-- 7k. notify_completion (body from 027_rain_check_move.sql)
--
-- A pending invitee must not be told what you did today — being notified is how
-- the old model told people they had been conscripted, and it is exactly the
-- part being replaced.

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
    v_title := v_habit.emoji || ' ' || v_habit.display_name || ' completed ' || v_habit.title;
    v_body  := 'Tap to see their progress!';
    v_type  := 'completion';
  END IF;

  FOR v_share IN
    SELECT hs.shared_with, p.push_subscription, p.notification_prefs, p.timezone
    FROM habit_shares hs
    JOIN profiles p ON p.id = hs.shared_with
    WHERE hs.habit_id = NEW.habit_id
      AND hs.status = 'accepted'
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

-- ── 8. is_shared retires ──
--
-- Nothing reads it any more: 7g was its last live caller. The `is_shared` alias
-- inside get_group_timeline_activity and get_feed_groups_latest_completions is a
-- CTE column computed from group_habit_shares, unrelated to this one.
-- Dropping it takes idx_habits_active_shared with it.

ALTER TABLE public.habits DROP COLUMN IF EXISTS is_shared;

-- ── 9. The state machine ──

-- 9a. Invite: the owner asks a friend to watch.

CREATE OR REPLACE FUNCTION public.invite_habit_partner(
  p_habit_id UUID,
  p_user_id  UUID
)
RETURNS public.habit_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_row   habit_shares;
BEGIN
  SELECT user_id INTO v_owner FROM habits WHERE id = p_habit_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Habit not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Only the habit owner can invite partners' USING ERRCODE = 'P0004';
  END IF;

  IF p_user_id = v_owner THEN
    RAISE EXCEPTION 'Cannot invite yourself' USING ERRCODE = 'P0004';
  END IF;

  -- Same bar as encouragements: you can only involve people you are friends
  -- with. Visibility is not consulted — inviting is how a private habit gets
  -- partners at all.
  IF NOT are_friends(v_owner, p_user_id) THEN
    RAISE EXCEPTION 'Can only invite friends' USING ERRCODE = 'P0004';
  END IF;

  INSERT INTO habit_shares (habit_id, shared_with, status, initiated_by)
  VALUES (p_habit_id, p_user_id, 'pending', v_owner)
  ON CONFLICT (habit_id, shared_with) DO UPDATE
    -- Re-inviting someone who declined is allowed: the owner is the one being
    -- turned down, so there is no way to use it to pester them. An already
    -- accepted row is left alone rather than reset to pending.
    SET status       = CASE WHEN habit_shares.status = 'accepted'
                            THEN 'accepted'::habit_partner_status
                            ELSE 'pending'::habit_partner_status END,
        initiated_by = CASE WHEN habit_shares.status = 'accepted'
                            THEN habit_shares.initiated_by
                            ELSE v_owner END,
        responded_at = CASE WHEN habit_shares.status = 'accepted'
                            THEN habit_shares.responded_at
                            ELSE NULL END
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_habit_partner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_habit_partner(UUID, UUID) TO authenticated;

-- 9b. Request: a friend asks to watch a public habit.

CREATE OR REPLACE FUNCTION public.request_habit_partner(p_habit_id UUID)
RETURNS public.habit_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner      UUID;
  v_visibility habit_visibility;
  v_me         UUID := auth.uid();
  v_existing   habit_shares;
  v_recent     INT;
  v_row        habit_shares;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0004';
  END IF;

  SELECT user_id, visibility INTO v_owner, v_visibility
  FROM habits WHERE id = p_habit_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Habit not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner = v_me THEN
    RAISE EXCEPTION 'Cannot request your own habit' USING ERRCODE = 'P0004';
  END IF;

  -- Both gates, in order. A private habit is undiscoverable, so a request for
  -- one can only have come from a guessed id — it answers the same way as a
  -- habit that does not exist, and says nothing about whether it does.
  IF v_visibility <> 'public' OR NOT are_friends(v_owner, v_me) THEN
    RAISE EXCEPTION 'Habit not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM habit_shares
  WHERE habit_id = p_habit_id AND shared_with = v_me;

  IF FOUND THEN
    IF v_existing.status = 'accepted' THEN
      RETURN v_existing;  -- already partners; asking again is a no-op
    END IF;

    IF v_existing.status = 'pending' THEN
      RETURN v_existing;  -- already asked, or already invited; likewise
    END IF;

    -- Declined. The owner may re-invite whenever they like (9a), but the person
    -- who was turned down waits a week before asking again, so "no" is a real
    -- answer rather than something to be worn down.
    IF v_existing.responded_at IS NOT NULL
       AND v_existing.responded_at > now() - interval '7 days' THEN
      RAISE EXCEPTION 'This request was declined recently'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Same shape as check_friendship_rate_limit (003): a cap on how much of this
  -- one person can generate per hour.
  SELECT count(*)::int INTO v_recent
  FROM habit_shares
  WHERE initiated_by = v_me
    AND status = 'pending'
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many partner requests'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO habit_shares (habit_id, shared_with, status, initiated_by)
  VALUES (p_habit_id, v_me, 'pending', v_me)
  ON CONFLICT (habit_id, shared_with) DO UPDATE
    SET status       = 'pending',
        initiated_by = v_me,
        responded_at = NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_habit_partner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_habit_partner(UUID) TO authenticated;

-- 9c. Respond: the side that did not start it answers.

CREATE OR REPLACE FUNCTION public.respond_habit_partner(
  p_share_id UUID,
  p_accept   BOOLEAN
)
RETURNS public.habit_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share     habit_shares;
  v_owner     UUID;
  v_me        UUID := auth.uid();
  v_responder UUID;
  v_row       habit_shares;
BEGIN
  SELECT * INTO v_share FROM habit_shares WHERE id = p_share_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been answered' USING ERRCODE = 'P0004';
  END IF;

  SELECT user_id INTO v_owner FROM habits WHERE id = v_share.habit_id;

  -- Whoever did not start it is the one who answers. An owner cannot accept
  -- their own invitation on the invitee's behalf, and a requester cannot wave
  -- their own request through.
  v_responder := CASE WHEN v_share.initiated_by = v_owner
                      THEN v_share.shared_with
                      ELSE v_owner END;

  IF v_me IS DISTINCT FROM v_responder THEN
    RAISE EXCEPTION 'Not yours to answer' USING ERRCODE = 'P0004';
  END IF;

  -- The friendship can have ended between asking and answering.
  IF p_accept AND NOT are_friends(v_owner, v_share.shared_with) THEN
    RAISE EXCEPTION 'Can only partner with friends' USING ERRCODE = 'P0004';
  END IF;

  UPDATE habit_shares
  SET status       = CASE WHEN p_accept THEN 'accepted'::habit_partner_status
                                        ELSE 'declined'::habit_partner_status END,
      responded_at = now()
  WHERE id = p_share_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_habit_partner(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_habit_partner(UUID, BOOLEAN) TO authenticated;

-- 9d. Cancel: withdraw, decline-by-ignoring, revoke, or leave.
--
-- One verb for all four, because they are the same row going away and the
-- difference is only which end pressed the button. Expressible as DELETE
-- policies (7e plus the owner's existing "Habit owner manages shares"), but
-- routed through a function so the client has one partnership API rather than
-- an RPC for three transitions and a raw DELETE for the fourth.

CREATE OR REPLACE FUNCTION public.cancel_habit_partner(p_share_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share habit_shares;
  v_owner UUID;
BEGIN
  SELECT * INTO v_share FROM habit_shares WHERE id = p_share_id;

  IF NOT FOUND THEN
    RETURN;  -- already gone; deleting twice is not an error
  END IF;

  SELECT user_id INTO v_owner FROM habits WHERE id = v_share.habit_id;

  IF auth.uid() NOT IN (v_owner, v_share.shared_with) THEN
    RAISE EXCEPTION 'Not yours to cancel' USING ERRCODE = 'P0004';
  END IF;

  DELETE FROM habit_shares WHERE id = p_share_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_habit_partner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_habit_partner(UUID) TO authenticated;

-- ── 10. Reading the state machine ──

-- 10a. The inbox: everything pending that is mine to answer.

CREATE OR REPLACE FUNCTION public.get_partner_inbox()
RETURNS TABLE (
  share_id      UUID,
  habit_id      UUID,
  habit_title   TEXT,
  habit_emoji   TEXT,
  habit_color   TEXT,
  visibility    habit_visibility,
  direction     TEXT,
  person_id     UUID,
  person_name   TEXT,
  person_avatar TEXT,
  person_username TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Invitations to me: the owner started it, so I am the one who answers.
  SELECT
    hs.id, h.id, h.title,
    coalesce(h.emoji, '✅'), coalesce(h.color, '#6366F1'),
    h.visibility,
    'invite'::TEXT,
    p.id, p.display_name, p.avatar_url, p.username,
    hs.created_at
  FROM habit_shares hs
  JOIN habits h   ON h.id = hs.habit_id
  JOIN profiles p ON p.id = h.user_id
  WHERE hs.shared_with = auth.uid()
    AND hs.status = 'pending'
    AND hs.initiated_by = h.user_id

  UNION ALL

  -- Requests on my habits: they started it, so I answer.
  SELECT
    hs.id, h.id, h.title,
    coalesce(h.emoji, '✅'), coalesce(h.color, '#6366F1'),
    h.visibility,
    'request'::TEXT,
    p.id, p.display_name, p.avatar_url, p.username,
    hs.created_at
  FROM habit_shares hs
  JOIN habits h   ON h.id = hs.habit_id
  JOIN profiles p ON p.id = hs.shared_with
  WHERE h.user_id = auth.uid()
    AND hs.status = 'pending'
    AND hs.initiated_by = hs.shared_with

  ORDER BY created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_partner_inbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_inbox() TO authenticated;

-- 10b. Discovery: a friend's habits, as I am allowed to see them.
--
-- Returns their public habits plus any private ones I am already a partner on —
-- the latter are visible to me anyway, and hiding them from the one page that
-- lists their habits would only be confusing.
--
-- streak_current and streak_best come back NULL unless I am an accepted
-- partner. That is the whole privacy gradient: public tells a friend the habit
-- exists and what it is called, so they have something to ask about; the
-- numbers arrive with the partnership.

CREATE OR REPLACE FUNCTION public.get_profile_habits(p_user_id UUID)
RETURNS TABLE (
  habit_id       UUID,
  title          TEXT,
  emoji          TEXT,
  color          TEXT,
  visibility     habit_visibility,
  partner_status TEXT,
  share_id       UUID,
  is_initiator   BOOLEAN,
  streak_current INT,
  streak_best    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0004';
  END IF;

  -- Your own profile would be the dashboard, and a stranger's is not on offer.
  IF p_user_id <> v_me AND NOT are_friends(p_user_id, v_me) THEN
    RAISE EXCEPTION 'Not friends' USING ERRCODE = 'P0004';
  END IF;

  RETURN QUERY
  SELECT
    h.id,
    h.title,
    coalesce(h.emoji, '✅'),
    coalesce(h.color, '#6366F1'),
    h.visibility,
    hs.status::TEXT,
    hs.id,
    (hs.initiated_by = v_me),
    CASE WHEN p_user_id = v_me OR hs.status = 'accepted'
         THEN coalesce(h.streak_current, 0) END,
    CASE WHEN p_user_id = v_me OR hs.status = 'accepted'
         THEN coalesce(h.streak_best, 0) END
  FROM habits h
  LEFT JOIN habit_shares hs
    ON hs.habit_id = h.id AND hs.shared_with = v_me
  WHERE h.user_id = p_user_id
    AND h.is_paused = false
    AND (
      p_user_id = v_me
      OR h.visibility = 'public'
      OR hs.status = 'accepted'
    )
  ORDER BY h.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_habits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_habits(UUID) TO authenticated;
