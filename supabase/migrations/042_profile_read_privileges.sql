-- ============================================================
-- 042_profile_read_privileges.sql — a profile's private fields stay private
-- ============================================================
--
-- Friends, people on either end of a pending request, and fellow group
-- members may read each other's profile rows (002). With Supabase's
-- table-wide SELECT grant that meant every column of them: date of birth,
-- notification settings, the old push subscription, is_admin. 002 meant to
-- stop that with column-level REVOKEs, but a table-wide grant overrides
-- those — the same trap 041 closed for writes.
--
-- So SELECT, too, is granted column by column, and only for the columns that
-- are anyone else's business:
--
--   id, display_name, username, avatar_url   who someone is
--   timezone                                  when their "today" is
--   created_at
--   has_date_of_birth                         whether the profile is finished
--
-- The owner reads the rest through functions that only ever answer for the
-- caller: get_own_notification_settings (prefs and push), is_app_admin,
-- get_checkin_audience. Those, and everything else that reads profiles
-- server-side, run as their owner and are untouched by this.
--
-- The app only ever asked for a date of birth to learn whether the profile
-- had been finished: complete_oauth_profile is where it gets set, and an
-- account without one is sent back there. has_date_of_birth answers that
-- without handing over the date.
--
-- anon gets the same columns so that its reads still come back empty under
-- "Anon cannot read profiles", rather than turning into errors.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_date_of_birth BOOLEAN NOT NULL
    GENERATED ALWAYS AS (date_of_birth IS NOT NULL) STORED;

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  display_name,
  username,
  avatar_url,
  timezone,
  created_at,
  has_date_of_birth
) ON public.profiles TO anon, authenticated;
