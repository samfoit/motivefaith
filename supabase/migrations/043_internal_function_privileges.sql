-- ============================================================
-- 043_internal_function_privileges.sql — helpers stay internal
-- ============================================================
--
-- Supabase grants EXECUTE on every new function to anon and authenticated by
-- name, so the "REVOKE ALL ... FROM PUBLIC" that 029 and 034 used to keep
-- these to themselves left both grants standing, and PostgREST serves each
-- one at /rpc/<name>. Four of them answer questions about other people, to
-- anyone holding the ids, signed in or not:
--
--   habit_partner_ids(habit)    who partners on any habit
--   habit_group_ids(habit)      which groups see any habit
--   are_friends(a, b)           whether any two people are friends
--   is_accepted_partner(h, u)   whether anyone partners on any habit
--
-- The first three are only ever called from SECURITY DEFINER functions —
-- share_capture, can_read_capture_media, get_incomplete_habits_today,
-- get_checkin_audience, get_profile_habits and the partner handshake — which
-- run as their owner, so no API role needs them at all.
--
-- is_accepted_partner is different: "Shared habits readable" and "Shared
-- completions readable" call it as whoever is querying, so signed-in users
-- keep it. Only anon loses it, and those two policies stop applying to anon,
-- which no partnership could ever have let through anyway: auth.uid() is null
-- for it. Without that, a signed-out read of either table would turn from an
-- empty answer into an error.

REVOKE EXECUTE ON FUNCTION public.habit_partner_ids(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.habit_group_ids(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.are_friends(UUID, UUID) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_accepted_partner(UUID, UUID) FROM anon;
ALTER POLICY "Shared habits readable" ON public.habits TO authenticated;
ALTER POLICY "Shared completions readable" ON public.completions TO authenticated;
