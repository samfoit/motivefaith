-- ============================================================
-- 059_checkin_media_needs_a_row.sql — a check-in's file is readable only
-- while a check-in shows it
-- ============================================================
--
-- The completions bucket's SELECT policy (034) still carried 005's habit-
-- folder clause: an accepted partner on habit H could read any file whose
-- second path segment was H, under anyone's folder. Nothing tied the file to
-- a check-in, so:
--
--   - deleting a check-in did not take its photo, video or voice note away.
--     Deletes leave the file in the bucket, and the partner could keep
--     fetching it (from a cached path, or the realtime payload they saw);
--   - the first segment was never checked against the habit's owner, so a
--     file anyone put under {them}/{H}/ was readable by H's partners.
--
-- can_read_capture_media (034) already covers every legitimate partner
-- read: a live completion carries the path, its owner is the folder's, and
-- the reader is a partner on its habit or a member of one of its groups.
-- So the clause is dropped and that function is the only way in besides the
-- owner's own folder. Private media (039) was never reachable by it and is
-- unaffected.

DROP POLICY IF EXISTS "Users read own or shared completions" ON storage.objects;

CREATE POLICY "Users read own or shared completions"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'completions'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.can_read_capture_media(name)
    )
  );
