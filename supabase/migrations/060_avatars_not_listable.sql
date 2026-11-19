-- ============================================================
-- 060_avatars_not_listable.sql — a photo is seen by its link, never found
-- by listing the bucket
-- ============================================================
--
-- avatars and group-avatars are public buckets: Storage serves
-- /object/public/... without consulting RLS at all. The SELECT policies 005
-- gave them, TO public, added nothing to that — except that anyone, signed
-- in or not, could list the buckets through the API and read off every
-- file name, which is every user and group id with a photo.
--
-- The photo itself stays public by its URL, which is now unguessable: each
-- upload gets a random name and the one before it is removed (see
-- src/lib/utils/avatar-upload.ts). Listing is kept to what the app does
-- with it: an owner tidying their own folder, a group admin their group's.

DROP POLICY IF EXISTS "Public avatar read access" ON storage.objects;
DROP POLICY IF EXISTS "Public group avatar read access" ON storage.objects;

CREATE POLICY "Users list own avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Group admins list group avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'group-avatars'
    -- CASE, not AND: SQL does not promise to check the shape first, and a
    -- folder that is not a uuid must fail the read, not raise on the cast.
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN is_group_admin((storage.foldername(name))[1]::uuid)
      ELSE false
    END
  );
