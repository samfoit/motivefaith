-- ============================================================
-- 005_complete_profile.sql — OAuth profile completion
-- ============================================================

-- ── Update handle_new_user to pull Google OAuth metadata ──

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, username, avatar_url, date_of_birth)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      'User'
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'username',
      'user_' || SUBSTR(NEW.id::text, 1, 8)
    ),
    COALESCE(
      NEW.raw_user_meta_data ->> 'avatar_url',
      NEW.raw_user_meta_data ->> 'picture'
    ),
    (NEW.raw_user_meta_data ->> 'date_of_birth')::date
  );
  RETURN NEW;
END;
$$;

-- ── complete_oauth_profile: one-time profile setup for OAuth users ──

CREATE OR REPLACE FUNCTION complete_oauth_profile(
  p_display_name TEXT,
  p_username TEXT,
  p_date_of_birth DATE,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_age INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Validate display name
  IF p_display_name IS NULL OR char_length(trim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'Display name is required';
  END IF;
  IF char_length(p_display_name) > 100 THEN
    RAISE EXCEPTION 'Display name too long';
  END IF;

  -- Validate username format
  IF p_username !~ '^[a-zA-Z0-9_]{3,30}$' THEN
    RAISE EXCEPTION 'Username must be 3-30 characters: letters, numbers, underscores only';
  END IF;

  -- Check username uniqueness (case-insensitive)
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE lower(username) = lower(p_username)
      AND id != auth.uid()
  ) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  -- Age verification
  IF p_date_of_birth IS NULL THEN
    RAISE EXCEPTION 'Date of birth is required';
  END IF;

  v_age := EXTRACT(YEAR FROM age(current_date, p_date_of_birth))::int;
  IF v_age < 13 THEN
    RAISE EXCEPTION 'You must be at least 13 years old to create an account';
  END IF;

  -- Update profile
  UPDATE profiles
  SET
    display_name = p_display_name,
    username = lower(p_username),
    date_of_birth = p_date_of_birth,
    avatar_url = COALESCE(p_avatar_url, avatar_url)
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION complete_oauth_profile(TEXT, TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_oauth_profile(TEXT, TEXT, DATE, TEXT) TO authenticated;
