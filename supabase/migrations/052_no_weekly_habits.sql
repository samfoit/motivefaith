-- ============================================================
-- 052_no_weekly_habits.sql — a habit is kept on set days
-- ============================================================
--
-- "Once a week, any day" left a habit no day to be kept on: nothing was due
-- until Saturday, so there was no day to show up for and no miss to answer
-- for until the week was gone. A habit is built on set days, so a habit now
-- repeats on days of the week, and a once-a-week habit is one day a week.
--
-- No habit may be weekly from now on, made so or changed to it. NOT VALID:
-- none is weekly in production, so there is nothing to check, and the
-- constraint holds for every row written from here.
--
-- The weekly rules stay. A day is judged by the schedule the habit had then
-- (049), and habit_schedule_changes may still say a habit was weekly before;
-- update_streak(), get_habit_rate(), habit_day_status() and the saved
-- weekly reviews read those weeks as they were.

ALTER TABLE public.habits
  ADD CONSTRAINT chk_habit_not_weekly CHECK (frequency <> 'weekly') NOT VALID;

-- A challenge's frequency becomes each joiner's habit's, so a challenge is
-- kept on set days too.
ALTER TABLE public.group_challenges
  ADD CONSTRAINT chk_challenge_not_weekly CHECK (frequency <> 'weekly') NOT VALID;
