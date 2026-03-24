-- ============================================================
-- 003_triggers.sql — Trigger functions and triggers
-- ============================================================

-- ── handle_new_user: auto-create profile row on signup ──

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, username, date_of_birth)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'User'),
    COALESCE(
      NEW.raw_user_meta_data ->> 'username',
      'user_' || SUBSTR(NEW.id::text, 1, 8)
    ),
    (NEW.raw_user_meta_data ->> 'date_of_birth')::date
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── set_completed_date: timezone-aware date on completions ──

CREATE OR REPLACE FUNCTION set_completed_date()
RETURNS TRIGGER AS $$
DECLARE
  user_tz TEXT;
BEGIN
  SELECT coalesce(p.timezone, 'UTC') INTO user_tz
    FROM public.habits h
    JOIN public.profiles p ON p.id = h.user_id
    WHERE h.id = NEW.habit_id;

  NEW.completed_date := (coalesce(NEW.completed_at, now()) AT TIME ZONE coalesce(user_tz, 'UTC'))::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_set_completed_date
  BEFORE INSERT OR UPDATE OF completed_at ON completions
  FOR EACH ROW EXECUTE FUNCTION set_completed_date();

-- ── update_streak: streak calculation with row-level lock ──

CREATE OR REPLACE FUNCTION update_streak()
RETURNS TRIGGER AS $$
DECLARE
  prev_completion DATE;
  cur_streak INT;
BEGIN
  SELECT streak_current INTO cur_streak
    FROM public.habits
    WHERE id = NEW.habit_id
    FOR UPDATE;

  SELECT MAX(c.completed_date) INTO prev_completion
    FROM public.completions c
    WHERE c.habit_id = NEW.habit_id
      AND c.completed_date < NEW.completed_date;

  IF prev_completion = NEW.completed_date - 1 THEN
    UPDATE public.habits SET
      streak_current = cur_streak + 1,
      streak_best = GREATEST(streak_best, cur_streak + 1),
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
  ELSE
    UPDATE public.habits SET
      streak_current = 1,
      streak_best = GREATEST(streak_best, 1),
      total_completions = total_completions + 1
    WHERE id = NEW.habit_id;
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER on_completion_insert
  AFTER INSERT ON completions
  FOR EACH ROW EXECUTE FUNCTION update_streak();

-- ── Rate-limit triggers ──

CREATE OR REPLACE FUNCTION check_encouragement_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT count(*) INTO recent_count
  FROM encouragements
  WHERE user_id = NEW.user_id
    AND recipient_id = NEW.recipient_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many encouragements to this user'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_encouragement_rate_limit
  BEFORE INSERT ON encouragements
  FOR EACH ROW
  EXECUTE FUNCTION check_encouragement_rate_limit();

CREATE OR REPLACE FUNCTION check_friendship_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT count(*) INTO recent_count
  FROM friendships
  WHERE register_id = NEW.register_id
    AND created_at > now() - interval '1 hour';

  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many friend requests'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_friendship_rate_limit
  BEFORE INSERT ON friendships
  FOR EACH ROW
  EXECUTE FUNCTION check_friendship_rate_limit();

CREATE OR REPLACE FUNCTION check_group_message_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INT;
BEGIN
  SELECT count(*) INTO recent_count
  FROM group_messages
  WHERE user_id = NEW.user_id
    AND group_id = NEW.group_id
    AND created_at > now() - interval '1 minute';

  IF recent_count >= 30 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many messages'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_group_message_rate_limit
  BEFORE INSERT ON group_messages
  FOR EACH ROW
  EXECUTE FUNCTION check_group_message_rate_limit();

-- ── Rate-limit tracking cleanup triggers ──

CREATE OR REPLACE FUNCTION clean_old_invite_attempts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.invite_code_attempts
  WHERE attempted_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clean_invite_attempts
  AFTER INSERT ON invite_code_attempts
  FOR EACH STATEMENT
  EXECUTE FUNCTION clean_old_invite_attempts();

CREATE OR REPLACE FUNCTION clean_old_feed_access_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.feed_access_log
  WHERE accessed_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clean_feed_access_log
  AFTER INSERT ON feed_access_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION clean_old_feed_access_log();

CREATE OR REPLACE FUNCTION clean_old_profile_search_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.profile_search_log
  WHERE searched_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clean_profile_search_log
  AFTER INSERT ON profile_search_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION clean_old_profile_search_log();

-- ── before_user_created_hook (age verification) ──

CREATE OR REPLACE FUNCTION public.before_user_created_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dob TEXT;
  v_dob_date DATE;
  v_age INT;
BEGIN
  v_dob := event->'user'->'raw_user_meta_data'->>'date_of_birth';

  IF v_dob IS NULL OR v_dob = '' THEN
    RETURN jsonb_build_object(
      'decision', 'continue'
    );
  END IF;

  BEGIN
    v_dob_date := v_dob::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'decision', 'reject',
      'message', 'Invalid date of birth format'
    );
  END;

  v_age := EXTRACT(YEAR FROM age(current_date, v_dob_date))::int;

  IF v_age < 13 THEN
    RETURN jsonb_build_object(
      'decision', 'reject',
      'message', 'You must be at least 13 years old to create an account'
    );
  END IF;

  RETURN jsonb_build_object(
    'decision', 'continue'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.before_user_created_hook(JSONB) TO supabase_auth_admin;
REVOKE ALL ON FUNCTION public.before_user_created_hook(JSONB) FROM PUBLIC;
