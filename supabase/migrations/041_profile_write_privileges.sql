-- ============================================================
-- 041_profile_write_privileges.sql — nobody makes themselves an admin
-- ============================================================
--
-- "Users update own profile" (002) lets a user update their own row, and the
-- API roles hold Supabase's default table-wide grants, so that meant every
-- column of it — is_admin included. One request from any signed-in user,
--
--   supabase.from("profiles").update({ is_admin: true }).eq("id", me)
--
-- and is_app_admin() said yes: the moderation queue, reports and every admin
-- route were theirs. INSERT was the same through "Users insert own profile",
-- for an account whose profile row is missing.
--
-- The column-level REVOKEs in 002 look as though they guard columns, but a
-- column privilege can't take away what a table-wide one grants, so they have
-- never done anything. RLS decides which rows; only privileges decide which
-- columns.
--
-- So the table-wide write grants go, and only what the app writes straight
-- to the table is granted back, column by column:
--
--   avatar_url   onboarding's avatar step
--   timezone     synced from the browser on every app load (providers.tsx)
--
-- Everything else a user may change goes through a SECURITY DEFINER function
-- that checks it first — update_own_profile, complete_oauth_profile (username
-- format and uniqueness, age), update_own_notification_prefs,
-- confirm_checkin_sharing — and those run as their owner, untouched by this.
-- Profiles are only ever created by handle_new_user, also as owner, so no API
-- role needs INSERT; "Users insert own profile" stays, but there is nothing
-- left for it to let through.
--
-- A column added later starts closed to clients until it is granted here,
-- which is the safe way round. service_role keeps its own grants: making
-- someone an admin is for the dashboard or the service key, never the app.

REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;

GRANT UPDATE (avatar_url, timezone) ON public.profiles TO authenticated;
