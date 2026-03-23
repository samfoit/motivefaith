-- ============================================================
-- 005_storage.sql — Storage buckets and policies
-- ============================================================

-- ── avatars bucket (public) ──

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('avatars', 'avatars', true,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  5242880)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Public avatar read access"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- ── completions bucket (private) ──

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('completions', 'completions', false,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime'],
  52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users upload own completions"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'completions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own completions"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'completions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users read own or shared completions"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'completions'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM habit_shares hs
        WHERE hs.shared_with = auth.uid()
          AND hs.habit_id::text = (storage.foldername(name))[2]
      )
    )
  );

-- ── group-avatars bucket (public, admin-only upload) ──

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('group-avatars', 'group-avatars', true,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  5242880)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Group admins upload avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'group-avatars'
    AND is_group_admin((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Group admins update avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'group-avatars'
    AND is_group_admin((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Group admins delete avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'group-avatars'
    AND is_group_admin((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Public group avatar read access"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'group-avatars');
