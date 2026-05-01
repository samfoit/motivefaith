-- The weekly-summary edge function is invoked hourly by cron and filters
-- eligible profiles to Sunday 17:00–21:00 in the user's timezone. That
-- window spans five cron runs and there is no dedup, so users have been
-- receiving ~5 weekly summary pushes every Sunday evening.
--
-- This migration adds a dedup column on profiles. The function will set
-- it to today's date (in the user's tz) after a successful send and skip
-- profiles already marked for this week.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_weekly_summary_date DATE;
