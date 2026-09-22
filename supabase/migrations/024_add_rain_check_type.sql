-- supabase:no-transaction
-- ============================================================
-- 024 — Add 'rain_check' completion type
-- ============================================================
--
-- A rain check is a deliberate skip: the day is marked as handled so the
-- streak survives, but nothing is counted as a completion. It is modelled
-- as a completion_type so it inherits RLS, realtime, the offline queue and
-- the feed/journey merge without new plumbing.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, and the new
-- value cannot be referenced by other statements in the same transaction —
-- hence its own no-transaction migration ahead of 025.

ALTER TYPE completion_type ADD VALUE IF NOT EXISTS 'rain_check';
