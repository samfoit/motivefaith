-- =============================================================================
-- The weekly review's days, on a database that ran 051 without them (migration 057)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/weekly-review-days.test.sql
--
-- Production ran an early 051: weekly_reviews had no `days` column and there
-- was no habit_day_status(), so every day of every week said "No habits yet
-- on this day". 057 brings such a database to where 051 ends and fills in the
-- weeks it had already saved.
--
-- This puts the database in that state first — the column and the function
-- taken away, weeks saved without their days — then runs 057 over it, by
-- file, and checks what the page would now read. It reads the real clock, so
-- "last week" is the Sunday-to-Saturday before the real one. Everything is
-- rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Last week's Sunday, and a day of it at a given time.
CREATE FUNCTION public._w() RETURNS DATE
LANGUAGE sql AS $fn$
  SELECT (now() AT TIME ZONE 'UTC')::date - EXTRACT(DOW FROM (now() AT TIME ZONE 'UTC')::date)::int - 7
$fn$;

CREATE FUNCTION public._at(p_day DATE, p_time TIME DEFAULT '12:00') RETURNS TIMESTAMPTZ
LANGUAGE sql AS $fn$ SELECT (p_day + p_time) AT TIME ZONE 'UTC' $fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- ada   "Run" every day and "Read" on Mon/Wed/Fri, both three weeks old.
--       Last week: ran Sun, Mon at 06:45 and Tue; read Mon, and Tue too,
--       though it wasn't due. The week before: ran Sunday.
-- gone  had a habit and a saved week, then deleted the habit.

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wd-ada@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"wd_ada"}'::jsonb,  now(), now()),
  ('e0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wd-gone@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"username":"wd_gone"}'::jsonb, now(), now());

UPDATE public.profiles SET timezone = 'UTC'
WHERE id IN ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002');

INSERT INTO public.habits (id, user_id, title, emoji, frequency, schedule, created_at) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Run',  '🏃', 'daily', '{"days":[0,1,2,3,4,5,6]}', public._at(public._w() - 14)),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'Read', '📖', 'daily', '{"days":[1,3,5]}',         public._at(public._w() - 14)),
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002', 'Walk', '🚶', 'daily', '{"days":[0,1,2,3,4,5,6]}', public._at(public._w() - 14));

INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'quick', public._at(public._w())),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'quick', public._at(public._w() + 1, '06:45')),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'quick', public._at(public._w() + 2)),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'quick', public._at(public._w() + 1, '21:10')),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'quick', public._at(public._w() + 2)),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'quick', public._at(public._w() - 7)),
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000002', 'quick', public._at(public._w() + 3));

-- Saved as a finished 051 saves them, so there is something to compare with.
SELECT public.save_weekly_review('e0000000-0000-4000-8000-000000000001', public._w(), true);
SELECT public.save_weekly_review('e0000000-0000-4000-8000-000000000001', public._w() - 7, false);
SELECT public.save_weekly_review('e0000000-0000-4000-8000-000000000002', public._w(), true);

-- The owner deletes their only habit after the week was saved. (Before the
-- weeks are noted down: the week's link to its most-checked-in habit goes
-- with the habit, which is 051's doing and not what is being tested.)
DELETE FROM public.habits WHERE id = 'e1000000-0000-4000-8000-000000000003';

CREATE TABLE public._saved AS
SELECT w.user_id, w.week_start, w.days, to_jsonb(w) - 'days' AS rest
FROM public.weekly_reviews w
WHERE w.user_id IN ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002');

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public._saved) = 3, 'fixture: three weeks should have been saved';
  ASSERT (SELECT bool_and((SELECT count(*) FROM jsonb_object_keys(s.days)) = 7) FROM public._saved s),
         'fixture: a finished 051 saves seven days with each week';
END $$;

-- ---------------------------------------------------------------------------
-- The database as production had it: no days, and nothing to work them out
-- ---------------------------------------------------------------------------

ALTER TABLE public.weekly_reviews DROP COLUMN days;
DROP FUNCTION public.habit_day_status(UUID, DATE, DATE);

DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.weekly_reviews w WHERE w.days IS NOT NULL;
    RAISE EXCEPTION 'fixture: the days column should be gone';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $$;

\ir ../supabase/migrations/057_weekly_review_days.sql

-- ---------------------------------------------------------------------------
-- Test 1: weeks saved without their days have them, as they would have been
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_wrong INT;
BEGIN
  SELECT count(*) INTO v_wrong
  FROM public.weekly_reviews w
  JOIN public._saved s USING (user_id, week_start)
  WHERE w.user_id = 'e0000000-0000-4000-8000-000000000001'
    AND w.days IS DISTINCT FROM s.days;
  ASSERT v_wrong = 0, format('TEST 1 FAILED: %s of the saved weeks came back with different days', v_wrong);

  ASSERT (SELECT count(*) FROM public.weekly_reviews w
          WHERE w.user_id = 'e0000000-0000-4000-8000-000000000001'
            AND (SELECT count(*) FROM jsonb_object_keys(w.days)) = 7) = 2,
         'TEST 1 FAILED: both of the saved weeks should have all seven days';
  RAISE NOTICE 'TEST 1 PASSED: saved weeks get the days a finished 051 would have saved';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: nothing else about a saved week changes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_wrong INT;
BEGIN
  SELECT count(*) INTO v_wrong
  FROM public.weekly_reviews w
  JOIN public._saved s USING (user_id, week_start)
  WHERE to_jsonb(w) - 'days' IS DISTINCT FROM s.rest;
  ASSERT v_wrong = 0, format('TEST 2 FAILED: %s saved weeks had their numbers or their saved time changed', v_wrong);
  ASSERT (SELECT count(*) FROM public.weekly_reviews w JOIN public._saved s USING (user_id, week_start)) = 3,
         'TEST 2 FAILED: a saved week went missing';
  RAISE NOTICE 'TEST 2 PASSED: a week''s numbers and when it was saved are untouched';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: what the page now reads for a day
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_days JSONB;
  v_monday JSONB;
  v_tuesday JSONB;
  v_thursday JSONB;
BEGIN
  SELECT w.days INTO v_days FROM public.weekly_reviews w
  WHERE w.user_id = 'e0000000-0000-4000-8000-000000000001' AND w.week_start = public._w();

  v_monday := v_days -> (public._w() + 1)::text;
  v_tuesday := v_days -> (public._w() + 2)::text;
  v_thursday := v_days -> (public._w() + 4)::text;

  ASSERT jsonb_array_length(v_monday) = 2, format('TEST 3 FAILED: Monday lists %s', v_monday);
  ASSERT v_monday @> '[{"title":"Run","emoji":"🏃","status":"done","times":["06:45"],"weekly":false}]'::jsonb,
         format('TEST 3 FAILED: Monday''s run reads %s', v_monday);
  ASSERT v_monday @> '[{"title":"Read","status":"done","times":["21:10"]}]'::jsonb,
         format('TEST 3 FAILED: Monday''s reading reads %s', v_monday);

  -- Read wasn't due on Tuesday and was done anyway.
  ASSERT v_tuesday @> '[{"title":"Run","status":"done"},{"title":"Read","status":"extra"}]'::jsonb,
         format('TEST 3 FAILED: Tuesday reads %s', v_tuesday);

  -- Thursday: the run was missed, and reading was not due.
  ASSERT v_thursday @> '[{"title":"Run","status":"missed","times":[]},{"title":"Read","status":"off"}]'::jsonb,
         format('TEST 3 FAILED: Thursday reads %s', v_thursday);

  RAISE NOTICE 'TEST 3 PASSED: each day lists its habits, done with their times, missed, or not due';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a week whose owner has since deleted every habit stays as it was
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_week RECORD;
BEGIN
  SELECT w.* INTO v_week FROM public.weekly_reviews w
  WHERE w.user_id = 'e0000000-0000-4000-8000-000000000002' AND w.week_start = public._w();
  ASSERT FOUND, 'TEST 4 FAILED: the week is gone';
  ASSERT v_week.days = '{}'::jsonb, format('TEST 4 FAILED: days are %s', v_week.days);
  ASSERT v_week.completions = 1, 'TEST 4 FAILED: its check-in count changed';
  RAISE NOTICE 'TEST 4 PASSED: with no habits left to read from, the week keeps its numbers and no days';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: the week still running has its days too
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  v_week RECORD;
  v_today TEXT := ((now() AT TIME ZONE 'UTC')::date)::text;
BEGIN
  SELECT * INTO v_week FROM public.get_current_week_review();
  ASSERT FOUND, 'TEST 5 FAILED: no running week';
  ASSERT v_week.week_start = public._w() + 7, format('TEST 5 FAILED: running week starts %s', v_week.week_start);
  ASSERT (SELECT count(*) FROM jsonb_object_keys(v_week.days)) = 7, 'TEST 5 FAILED: the running week has no days';
  ASSERT v_week.days -> v_today @> '[{"title":"Run"}]'::jsonb,
         format('TEST 5 FAILED: today reads %s', v_week.days -> v_today);

  -- And the habit page's rate still answers, from the same day-by-day count.
  ASSERT (SELECT r.due >= r.done AND r.done >= 4 FROM public.get_habit_rate('e1000000-0000-4000-8000-000000000001') r),
         'TEST 5 FAILED: the habit''s rate no longer counts its done days';
  RAISE NOTICE 'TEST 5 PASSED: the running week and the habit''s rate work';
END $$;

RESET role;
RESET request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Test 6: a week saved from now on carries its days
-- ---------------------------------------------------------------------------
-- The column comes back last in the table rather than where 051 put it, and
-- saving a week copies a whole row across by position.

DO $$
DECLARE
  v_week RECORD;
BEGIN
  DELETE FROM public.weekly_reviews
  WHERE user_id = 'e0000000-0000-4000-8000-000000000001' AND week_start = public._w();
  ASSERT public.save_weekly_review('e0000000-0000-4000-8000-000000000001', public._w(), true),
         'TEST 6 FAILED: the week was not saved';

  SELECT w.* INTO v_week FROM public.weekly_reviews w
  WHERE w.user_id = 'e0000000-0000-4000-8000-000000000001' AND w.week_start = public._w();
  ASSERT v_week.days = (SELECT s.days FROM public._saved s
                        WHERE s.user_id = v_week.user_id AND s.week_start = v_week.week_start),
         'TEST 6 FAILED: the newly saved week''s days are not what they were';
  ASSERT v_week.completions = 5 AND v_week.top_habit_title = 'Run' AND v_week.top_habit_count = 3,
         format('TEST 6 FAILED: saved %s check-ins, most on %s (%s)', v_week.completions, v_week.top_habit_title, v_week.top_habit_count);
  ASSERT v_week.daily_completions = jsonb_build_object(
           public._w()::text, 1, (public._w() + 1)::text, 2, (public._w() + 2)::text, 2),
         format('TEST 6 FAILED: daily counts are %s', v_week.daily_completions);
  RAISE NOTICE 'TEST 6 PASSED: a week saved after the migration has every field in its own place';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: running it again changes nothing
-- ---------------------------------------------------------------------------

CREATE TABLE public._after_first AS
SELECT w.user_id, w.week_start, to_jsonb(w) AS row_json FROM public.weekly_reviews w;

\ir ../supabase/migrations/057_weekly_review_days.sql

DO $$
DECLARE
  v_changed INT;
BEGIN
  SELECT count(*) INTO v_changed
  FROM public.weekly_reviews w
  FULL JOIN public._after_first a USING (user_id, week_start)
  WHERE to_jsonb(w) IS DISTINCT FROM a.row_json;
  ASSERT v_changed = 0, format('TEST 7 FAILED: a second run changed %s weeks', v_changed);
  RAISE NOTICE 'TEST 7 PASSED: a second run leaves every week as it was';
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: who may call what is as 051 left it
-- ---------------------------------------------------------------------------

SET LOCAL role TO anon;

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT * FROM public.get_habit_rate('e1000000-0000-4000-8000-000000000001')$q$,
    $q$SELECT * FROM public.habit_day_status('e1000000-0000-4000-8000-000000000001', current_date, current_date)$q$,
    $q$SELECT * FROM public.habit_rate_between('e1000000-0000-4000-8000-000000000001', NULL, NULL)$q$,
    $q$SELECT * FROM public.get_current_week_review()$q$,
    $q$SELECT * FROM public.weekly_review_numbers('e0000000-0000-4000-8000-000000000001', public._w(), true)$q$,
    $q$SELECT public.save_weekly_review('e0000000-0000-4000-8000-000000000001', public._w(), true)$q$,
    $q$SELECT public.save_weekly_reviews()$q$,
    $q$SELECT count(*) FROM public.weekly_reviews$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 8 FAILED: anon could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

RESET role;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE
  call TEXT;
BEGIN
  -- Someone else, signed in: the helpers that answer for anyone stay closed,
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT * FROM public.weekly_review_numbers('e0000000-0000-4000-8000-000000000001', public._w(), true)$q$,
    $q$SELECT public.save_weekly_review('e0000000-0000-4000-8000-000000000001', public._w(), true)$q$,
    $q$SELECT public.save_weekly_reviews()$q$,
    $q$UPDATE public.weekly_reviews SET done = 0$q$,
    $q$DELETE FROM public.weekly_reviews$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 8 FAILED: a signed-in user could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- and they read their own weeks only.
  ASSERT (SELECT count(*) FROM public.weekly_reviews) = 1
     AND (SELECT bool_and(user_id = 'e0000000-0000-4000-8000-000000000002') FROM public.weekly_reviews),
         'TEST 8 FAILED: a signed-in user read weeks that are not theirs';

  RAISE NOTICE 'TEST 8 PASSED: the same people may call the same things';
  RAISE NOTICE '=== ALL WEEKLY REVIEW DAYS TESTS PASSED ===';
END $$;

ROLLBACK;
