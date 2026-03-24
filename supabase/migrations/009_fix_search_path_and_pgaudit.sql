-- ============================================================
-- 009_fix_search_path_and_pgaudit.sql
-- Move pgaudit to dedicated schema, set explicit search_path
-- on functions that were missing it
-- ============================================================

-- ── Move pgaudit out of public into a dedicated schema ──

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pgaudit SET SCHEMA extensions;

-- ── Fix search_path on is_valid_schedule ──

CREATE OR REPLACE FUNCTION public.is_valid_schedule(schedule jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  elem text;
BEGIN
  IF schedule IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(schedule->'days') != 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(schedule->'days') = 0 THEN RETURN false; END IF;
  FOR elem IN SELECT jsonb_array_elements_text(schedule->'days')
  LOOP
    IF elem::int NOT BETWEEN 0 AND 6 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- ── Fix search_path on cleanup trigger functions ──

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
