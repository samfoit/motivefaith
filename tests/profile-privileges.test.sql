-- =============================================================================
-- What a user may write and read in profiles (migrations 041, 042)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/profile-privileges.test.sql
--
-- RLS decides which profile rows a user may touch; privileges decide which of
-- their columns. Before 041 that was all of them, is_admin included, so any
-- user could make themselves an admin with one update. This checks the way in
-- is shut — by update, upsert and insert — and that every way the app really
-- changes a profile still works. Before 042 it was all of them for reading
-- too, so friends saw each other's date of birth: the second half checks only
-- the public columns are left.
--
-- Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- pam     an ordinary user
-- quin    another one
-- orphan  signed in, but their profile row is gone (a half-finished deletion)

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp-pam@test.com',    crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"pp_pam"}'::jsonb,    now(), now()),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp-quin@test.com',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"pp_quin"}'::jsonb,   now(), now()),
  ('83000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pp-orphan@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"pp_orphan"}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Pam', timezone = 'UTC', avatar_url = NULL
WHERE id = '81000000-0000-4000-8000-000000000001';
DELETE FROM public.profiles WHERE id = '83000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Test 1: a user can't make themselves an admin
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET is_admin = true
    WHERE id = '81000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST 1a FAILED: a user made themselves an admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Not by tucking it in beside a column they may write, either.
  BEGIN
    UPDATE public.profiles SET timezone = 'UTC', is_admin = true
    WHERE id = '81000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST 1b FAILED: is_admin rode along with timezone';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Nor through an upsert onto their own row.
  BEGIN
    INSERT INTO public.profiles (id, display_name, username, is_admin)
    VALUES ('81000000-0000-4000-8000-000000000001', 'Pam', 'pp_pam', true)
    ON CONFLICT (id) DO UPDATE SET is_admin = EXCLUDED.is_admin;
    RAISE EXCEPTION 'TEST 1c FAILED: an upsert made a user an admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  ASSERT NOT public.is_app_admin(), 'TEST 1 FAILED: is_app_admin() says yes';
  RAISE NOTICE 'TEST 1 PASSED: a user can''t make themselves an admin';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: an account missing its profile can't create an admin one
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"83000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, display_name, username, is_admin)
    VALUES ('83000000-0000-4000-8000-000000000003', 'Orphan', 'pp_orphan', true);
    RAISE EXCEPTION 'TEST 2 FAILED: an orphaned account inserted an admin profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'TEST 2 PASSED: an account missing its profile can''t create an admin one';
END $$;

RESET role;

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles
                     WHERE id = '83000000-0000-4000-8000-000000000003'),
    'TEST 2 FAILED: a profile row was created';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: what the app writes straight to the table still goes through
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  -- providers.tsx: the browser's timezone, only when it differs.
  UPDATE public.profiles SET timezone = 'Europe/London'
  WHERE id = '81000000-0000-4000-8000-000000000001' AND timezone <> 'Europe/London';
  ASSERT FOUND, 'TEST 3 FAILED: the timezone sync was refused';

  -- Onboarding's avatar step.
  UPDATE public.profiles SET avatar_url = 'emoji:🌅'
  WHERE id = '81000000-0000-4000-8000-000000000001';
  ASSERT FOUND, 'TEST 3 FAILED: the onboarding avatar was refused';

  ASSERT (SELECT timezone = 'Europe/London' AND avatar_url = 'emoji:🌅'
          FROM public.profiles WHERE id = '81000000-0000-4000-8000-000000000001'),
    'TEST 3 FAILED: the writes did not land';
  RAISE NOTICE 'TEST 3 PASSED: what the app writes straight to the table still goes through';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: checked fields can't be written around their checks
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  attempt TEXT;
BEGIN
  FOREACH attempt IN ARRAY ARRAY[
    -- complete_oauth_profile holds these to a format, uniqueness and an age.
    $q$UPDATE public.profiles SET username = 'Not Valid!' WHERE id = auth.uid()$q$,
    $q$UPDATE public.profiles SET date_of_birth = current_date WHERE id = auth.uid()$q$,
    $q$UPDATE public.profiles SET display_name = 'Admin' WHERE id = auth.uid()$q$,
    -- update_own_notification_prefs keeps only the keys it knows.
    $q$UPDATE public.profiles SET notification_prefs = '{"x": 1}' WHERE id = auth.uid()$q$,
    $q$UPDATE public.profiles SET push_subscription = '{}' WHERE id = auth.uid()$q$,
    $q$UPDATE public.profiles SET checkin_sharing_confirmed_at = now() WHERE id = auth.uid()$q$,
    $q$UPDATE public.profiles SET last_weekly_summary_date = current_date WHERE id = auth.uid()$q$
  ] LOOP
    BEGIN
      EXECUTE attempt;
      RAISE EXCEPTION 'TEST 4 FAILED: allowed %', attempt;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'TEST 4 PASSED: checked fields can''t be written around their checks';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: ...and the functions that check them still work
-- ---------------------------------------------------------------------------

SELECT public.update_own_profile(p_display_name := 'Pamela', p_avatar_url := 'emoji:🌿');
SELECT public.complete_oauth_profile('Pamela', 'pp_pamela', '1990-01-01');
SELECT public.update_own_notification_prefs('{"enabled": false}'::jsonb);
SELECT public.confirm_checkin_sharing();

RESET role;

DO $$
BEGIN
  ASSERT (
    SELECT display_name = 'Pamela'
       AND avatar_url = 'emoji:🌿'
       AND username = 'pp_pamela'
       AND date_of_birth = '1990-01-01'
       AND notification_prefs->>'enabled' = 'false'
       AND checkin_sharing_confirmed_at IS NOT NULL
    FROM public.profiles WHERE id = '81000000-0000-4000-8000-000000000001'
  ), 'TEST 5 FAILED: a profile function no longer writes';
  RAISE NOTICE 'TEST 5 PASSED: the functions that check them still work';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: someone else's row is still out of reach
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  UPDATE public.profiles SET timezone = 'Hacked/Zone'
  WHERE id = '81000000-0000-4000-8000-000000000001';
  ASSERT NOT FOUND, 'TEST 6 FAILED: quin wrote pam''s timezone';
  RAISE NOTICE 'TEST 6 PASSED: someone else''s row is still out of reach';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: signed out, nothing can be written at all
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO anon;

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET timezone = 'UTC';
    RAISE EXCEPTION 'TEST 7 FAILED: anon updated profiles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.profiles (id, display_name, username)
    VALUES (gen_random_uuid(), 'Ghost', 'pp_ghost');
    RAISE EXCEPTION 'TEST 7 FAILED: anon inserted a profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'TEST 7 PASSED: signed out, nothing can be written at all';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: an admin can still be made the proper way
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO service_role;
UPDATE public.profiles SET is_admin = true WHERE id = '82000000-0000-4000-8000-000000000002';

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  ASSERT public.is_app_admin(), 'TEST 8 FAILED: the service key could not make an admin';
  RAISE NOTICE 'TEST 8 PASSED: an admin can still be made the proper way';
END $$;

RESET role;

-- ===========================================================================
-- Reads (migration 042)
-- ===========================================================================
-- Friends may read each other's rows, but only the columns that are anyone's
-- business. pam's date of birth and notification settings were set above.

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 'accepted');

-- ---------------------------------------------------------------------------
-- Test 9: a friend sees who someone is, and nothing private
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE
  private_column TEXT;
BEGIN
  ASSERT (SELECT count(*) FROM public.profiles
          WHERE id = '81000000-0000-4000-8000-000000000001'
            AND display_name IS NOT NULL AND username IS NOT NULL
            AND timezone IS NOT NULL AND created_at IS NOT NULL
            AND has_date_of_birth) = 1,
    'TEST 9 FAILED: a friend should still see who pam is';

  FOREACH private_column IN ARRAY ARRAY[
    'date_of_birth', 'notification_prefs', 'push_subscription', 'is_admin',
    'last_weekly_summary_date', 'checkin_sharing_confirmed_at'
  ] LOOP
    BEGIN
      EXECUTE format(
        'SELECT %I FROM public.profiles WHERE id = %L',
        private_column, '81000000-0000-4000-8000-000000000001'
      );
      RAISE EXCEPTION 'TEST 9 FAILED: a friend read pam''s %', private_column;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'TEST 9 PASSED: a friend sees who someone is, and nothing private';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10: the owner gets their own private fields only through functions
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
BEGIN
  -- Column privileges hold for every row, the owner's included: what is
  -- theirs comes from functions that answer only for the caller.
  BEGIN
    PERFORM date_of_birth FROM public.profiles WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST 10 FAILED: date_of_birth was readable directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- And select("*") is refused outright, so it can't creep back in.
  BEGIN
    PERFORM * FROM public.profiles WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST 10 FAILED: select * was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  ASSERT (SELECT notification_prefs->>'enabled' FROM public.get_own_notification_settings()) = 'false',
    'TEST 10 FAILED: get_own_notification_settings no longer answers';
  ASSERT (SELECT has_date_of_birth FROM public.profiles WHERE id = auth.uid()),
    'TEST 10 FAILED: the owner can''t tell their profile is finished';
  RAISE NOTICE 'TEST 10 PASSED: the owner gets their own private fields only through functions';
END $$;

-- ---------------------------------------------------------------------------
-- Test 11: has_date_of_birth follows the date, and can't be set by hand
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
BEGIN
  ASSERT NOT (SELECT has_date_of_birth FROM public.profiles WHERE id = auth.uid()),
    'TEST 11 FAILED: quin has no date of birth yet';

  BEGIN
    UPDATE public.profiles SET has_date_of_birth = true WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST 11 FAILED: has_date_of_birth was written';
  -- Refused before privileges are even looked at: it is generated.
  EXCEPTION WHEN generated_always OR insufficient_privilege THEN NULL;
  END;

  PERFORM public.complete_oauth_profile('Quin', 'pp_quin', '1991-02-03');
  ASSERT (SELECT has_date_of_birth FROM public.profiles WHERE id = auth.uid()),
    'TEST 11 FAILED: finishing the profile did not show';
  RAISE NOTICE 'TEST 11 PASSED: has_date_of_birth follows the date, and can''t be set by hand';
END $$;

-- ---------------------------------------------------------------------------
-- Test 12: signed out, reads still come back empty rather than failing
-- ---------------------------------------------------------------------------

RESET role;
SET LOCAL role TO anon;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.profiles
          WHERE id = '81000000-0000-4000-8000-000000000001') = 0,
    'TEST 12 FAILED: anon saw a profile';
  RAISE NOTICE 'TEST 12 PASSED: signed out, reads still come back empty rather than failing';
END $$;

RESET role;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL PROFILE PRIVILEGE TESTS PASSED ==='; END $$;

ROLLBACK;
