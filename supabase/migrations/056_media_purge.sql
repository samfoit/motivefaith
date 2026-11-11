-- ============================================================
-- 056_media_purge.sql — deleted media leaves storage too
-- ============================================================
--
-- Nothing ever removed a file from storage. Deleting a habit, a group or an
-- account, or a moderator removing a check-in, deleted the rows and left
-- every photo, video and voice note where it was. (Account deletion tried:
-- it listed the user's folder, got back the folders inside it rather than
-- the files, and removed nothing.)
--
-- Postgres cannot remove a stored file itself — storage.objects refuses a
-- direct delete, and the file would stay in the bucket anyway — so it writes
-- down what has to go, in the same transaction as the delete that orphaned
-- it, and the purge-media function removes those files through the Storage
-- API (cron, hourly). Account deletion and moderator removals also remove
-- their files straight away, from the app's server; this is what makes sure
-- of it when that call fails, and what covers habits and groups.
--
-- Only a path a deleted row pointed at, or a file in a deleted owner's own
-- folder, is ever queued. A file nothing was ever attached to is left alone:
-- an upload lands a moment before the row that points at it.
--
-- One capture can be sent to a habit, a friend and a group at once, so a path
-- is queued only when no row points at it any more, and checked once more
-- when it is taken off the queue.

-- ── 1. A stored reference, as a path in the bucket ──
--
-- evidence_url and media_path hold the path ("<user>/<habit>/<ts>.webp").
-- The oldest check-ins hold a signed URL to the same file instead.

CREATE OR REPLACE FUNCTION public.media_storage_path(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value ~ '^[0-9a-fA-F-]{36}/.' THEN p_value
    WHEN p_value ~ '^https?://' THEN substring(
      p_value FROM '/storage/v1/object/(?:sign|public|authenticated)/completions/([0-9a-fA-F-]{36}/[^?#]+)'
    )
  END;
$$;

-- The few rows still holding a URL, findable by the path inside it.
CREATE INDEX IF NOT EXISTS idx_completions_legacy_evidence_path
  ON public.completions (public.media_storage_path(evidence_url))
  WHERE evidence_url LIKE 'http%';

CREATE INDEX IF NOT EXISTS idx_completion_private_content_evidence_url
  ON public.completion_private_content (evidence_url)
  WHERE evidence_url IS NOT NULL;

-- ── 2. Does anything still point at this file? ──
--
-- Only its owner's rows count, as for who may read it (034): a file lives in
-- its uploader's folder, and nothing stops someone writing another person's
-- path into a row of their own. Such a row must not be able to keep that
-- person's file in storage after they delete it — nor, below, to release it.

CREATE OR REPLACE FUNCTION public.media_is_referenced(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH f AS (SELECT lower(split_part(p_path, '/', 1)) AS owner)
  SELECT EXISTS (
           SELECT 1 FROM public.completions c, f
           WHERE c.evidence_url = p_path AND c.user_id::text = f.owner
         )
      OR EXISTS (
           SELECT 1 FROM public.completions c, f
           WHERE c.evidence_url LIKE 'http%'
             AND public.media_storage_path(c.evidence_url) = p_path
             AND c.user_id::text = f.owner
         )
      OR EXISTS (
           SELECT 1 FROM public.completion_private_content p, f
           WHERE p.evidence_url = p_path AND p.user_id::text = f.owner
         )
      OR EXISTS (
           SELECT 1 FROM public.encouragements e, f
           WHERE e.media_path = p_path AND e.user_id::text = f.owner
         )
      OR EXISTS (
           SELECT 1 FROM public.group_messages g, f
           WHERE g.media_path = p_path AND g.user_id::text = f.owner
         );
$$;

REVOKE ALL ON FUNCTION public.media_is_referenced(text) FROM PUBLIC, anon, authenticated;

-- ── 3. What has to go ──

CREATE TABLE IF NOT EXISTS public.media_purge_queue (
  bucket          text        NOT NULL,
  path            text        NOT NULL,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  attempts        integer     NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  PRIMARY KEY (bucket, path),
  CONSTRAINT chk_media_purge_bucket
    CHECK (bucket IN ('completions', 'avatars', 'group-avatars')),
  -- Always a file inside an owner's folder, never a folder or a whole bucket.
  CONSTRAINT chk_media_purge_path
    CHECK (path ~ '^[0-9a-fA-F-]{36}/.')
);

-- Nobody's to read or write but the service role's, which skips RLS.
ALTER TABLE public.media_purge_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_purge_queue FROM PUBLIC, anon, authenticated;

-- ── 4. A row that pointed at a file is gone, or points elsewhere ──

CREATE OR REPLACE FUNCTION public.queue_orphaned_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old text;
BEGIN
  v_old := public.media_storage_path(to_jsonb(OLD) ->> TG_ARGV[0]);
  IF v_old IS NULL THEN
    RETURN NULL;
  END IF;

  -- A row only ever lets go of a file in its own author's folder.
  IF lower(split_part(v_old, '/', 1)) <> OLD.user_id::text THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND public.media_storage_path(to_jsonb(NEW) ->> TG_ARGV[0]) IS NOT DISTINCT FROM v_old THEN
    RETURN NULL;
  END IF;

  IF NOT public.media_is_referenced(v_old) THEN
    INSERT INTO public.media_purge_queue (bucket, path)
    VALUES ('completions', v_old)
    ON CONFLICT ON CONSTRAINT media_purge_queue_pkey DO NOTHING;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Tidying up is never the reason a delete fails.
  RAISE WARNING 'queue_orphaned_media on %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_orphaned_media() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_completions_media_purge
  AFTER DELETE OR UPDATE OF evidence_url ON public.completions
  FOR EACH ROW WHEN (OLD.evidence_url IS NOT NULL)
  EXECUTE FUNCTION public.queue_orphaned_media('evidence_url');

CREATE OR REPLACE TRIGGER trg_private_content_media_purge
  AFTER DELETE OR UPDATE OF evidence_url ON public.completion_private_content
  FOR EACH ROW WHEN (OLD.evidence_url IS NOT NULL)
  EXECUTE FUNCTION public.queue_orphaned_media('evidence_url');

CREATE OR REPLACE TRIGGER trg_encouragements_media_purge
  AFTER DELETE OR UPDATE OF media_path ON public.encouragements
  FOR EACH ROW WHEN (OLD.media_path IS NOT NULL)
  EXECUTE FUNCTION public.queue_orphaned_media('media_path');

CREATE OR REPLACE TRIGGER trg_group_messages_media_purge
  AFTER DELETE OR UPDATE OF media_path ON public.group_messages
  FOR EACH ROW WHEN (OLD.media_path IS NOT NULL)
  EXECUTE FUNCTION public.queue_orphaned_media('media_path');

-- ── 5. An owner is gone: everything in their folder goes ──
--
-- A deleted account's avatar and anything of theirs no row pointed at; a
-- deleted group's picture. The buckets to look in are the trigger's
-- arguments. Read from storage.objects, so it is every file that is really
-- there, whatever it is called.

CREATE OR REPLACE FUNCTION public.queue_owner_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.media_purge_queue (bucket, path)
  SELECT o.bucket_id, o.name
  FROM storage.objects o
  WHERE o.bucket_id = ANY (TG_ARGV)
    AND o.name LIKE OLD.id::text || '/%'
  ON CONFLICT ON CONSTRAINT media_purge_queue_pkey DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'queue_owner_media on %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_owner_media() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_profiles_media_purge
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.queue_owner_media('avatars', 'completions');

CREATE OR REPLACE TRIGGER trg_groups_media_purge
  AFTER DELETE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.queue_owner_media('group-avatars');

-- ── 6. Taking work off the queue ──
--
-- claim hands out the oldest entries that are due and marks them tried. An
-- entry something points at again is dropped instead: sent again, or a row
-- that was only moved. One that fails to delete comes round again in ten
-- minutes. finish is called with what was really removed.

CREATE OR REPLACE FUNCTION public.claim_media_purge(p_limit integer DEFAULT 100)
RETURNS TABLE (bucket text, path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
BEGIN
  DELETE FROM public.media_purge_queue q
  WHERE q.bucket = 'completions'
    AND public.media_is_referenced(q.path)
    AND (q.bucket, q.path) IN (
      SELECT d.bucket, d.path
      FROM public.media_purge_queue d
      WHERE d.last_attempt_at IS NULL
         OR d.last_attempt_at < now() - interval '10 minutes'
      ORDER BY d.queued_at
      LIMIT v_limit
    );

  RETURN QUERY
  UPDATE public.media_purge_queue q
  SET attempts = q.attempts + 1,
      last_attempt_at = now()
  WHERE (q.bucket, q.path) IN (
    SELECT d.bucket, d.path
    FROM public.media_purge_queue d
    WHERE d.last_attempt_at IS NULL
       OR d.last_attempt_at < now() - interval '10 minutes'
    ORDER BY d.queued_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.bucket, q.path;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_media_purge(p_bucket text, p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_done integer;
BEGIN
  DELETE FROM public.media_purge_queue q
  WHERE q.bucket = p_bucket
    AND q.path = ANY (p_paths);
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RETURN v_done;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_purge(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_media_purge(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_purge(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_media_purge(text, text[]) TO service_role;

-- ── 7. Hourly, between the other jobs ──

SELECT public.schedule_edge_function('purge-media', '20 * * * *');
