-- =============================================================================
-- A habit is kept on set days (migration 052)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/no-weekly-habits.test.sql
--
-- No habit or challenge may be "once a week, any day", made so or changed to
-- it. A habit that was weekly before keeps its weeks: changed to set days,
-- the change records it was weekly. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('d0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nw-ivy@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"nw_ivy"}'::jsonb, now(), now());

INSERT INTO public.habits (id, user_id, title, frequency, schedule) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Sundays', 'specific_days', '{"days":[0]}');

INSERT INTO public.groups (id, name, created_by)
VALUES ('d2000000-0000-4000-8000-000000000001', 'Ivy''s', 'd0000000-0000-4000-8000-000000000001');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.habits (user_id, title, frequency)
    VALUES ('d0000000-0000-4000-8000-000000000001', 'Any day', 'weekly');
    RAISE EXCEPTION 'TEST 1a FAILED: a weekly habit was made';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 1a PASSED: a habit cannot be made weekly';
  END;

  BEGIN
    UPDATE public.habits SET frequency = 'weekly' WHERE id = 'd1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST 1b FAILED: a habit was changed to weekly';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 1b PASSED: a habit cannot be changed to weekly';
  END;

  BEGIN
    INSERT INTO public.group_challenges (group_id, title, created_by, frequency)
    VALUES ('d2000000-0000-4000-8000-000000000001', 'Any day', 'd0000000-0000-4000-8000-000000000001', 'weekly');
    RAISE EXCEPTION 'TEST 1c FAILED: a weekly challenge was made';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 1c PASSED: a challenge cannot be made weekly';
  END;

  INSERT INTO public.group_challenges (group_id, title, created_by, frequency, schedule)
  VALUES ('d2000000-0000-4000-8000-000000000001', 'Sundays', 'd0000000-0000-4000-8000-000000000001', 'specific_days', '{"days":[0]}');
  RAISE NOTICE 'TEST 1d PASSED: a challenge on set days is made';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a habit that was weekly before keeps its weeks
-- ---------------------------------------------------------------------------

-- As one made before 052: NOT VALID leaves such a row alone.
ALTER TABLE public.habits DROP CONSTRAINT chk_habit_not_weekly;
INSERT INTO public.habits (id, user_id, title, frequency, schedule, created_at) VALUES
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'Old weekly', 'weekly',
   '{"days":[0,1,2,3,4,5,6]}', now() - interval '30 days');
ALTER TABLE public.habits
  ADD CONSTRAINT chk_habit_not_weekly CHECK (frequency <> 'weekly') NOT VALID;

DO $$
BEGIN
  UPDATE public.habits SET frequency = 'specific_days', schedule = '{"days":[0]}'
  WHERE id = 'd1000000-0000-4000-8000-000000000002';
  ASSERT EXISTS (
    SELECT 1 FROM public.habit_schedule_changes
    WHERE habit_id = 'd1000000-0000-4000-8000-000000000002' AND frequency = 'weekly'
  ), 'TEST 2 FAILED: the change should record that it was weekly';
  RAISE NOTICE 'TEST 2 PASSED: a weekly habit moved to set days keeps its weekly weeks';
END $$;

ROLLBACK;
