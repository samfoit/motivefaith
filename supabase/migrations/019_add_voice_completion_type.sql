-- supabase:no-transaction
-- ============================================================
-- 019 — Add 'voice' completion type and audio storage support
-- ============================================================

ALTER TYPE completion_type ADD VALUE IF NOT EXISTS 'voice';

-- Allow audio uploads in the completions storage bucket
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'
]
WHERE id = 'completions';
