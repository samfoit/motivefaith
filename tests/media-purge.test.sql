-- =============================================================================
-- Deleted media leaves storage too (migration 056)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/media-purge.test.sql
--
-- Postgres cannot remove a stored file, so every delete that leaves one
-- behind writes its path to media_purge_queue, and purge-media removes it
-- through the Storage API. What matters here is what gets queued and what
-- does not: a file is queued when the last row pointing at it goes, never
-- while a check-in, a message or a group post still shows it, and never
-- because someone else's row was deleted.
--
-- The storage.objects rows are stand-ins with no file behind them.
-- Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- owner   has "Run" and "Read", a group, an avatar, and media of every kind
-- friend  owner's friend, in the group, with media of their own

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mp-owner@test.com',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mp-friend@test.com', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

UPDATE public.profiles SET display_name = 'Owner', username = 'mp_owner', timezone = 'UTC'
WHERE id = 'b1000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET display_name = 'Friend', username = 'mp_friend', timezone = 'UTC'
WHERE id = 'b2000000-0000-4000-8000-000000000002';

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'accepted');

INSERT INTO public.habits (id, user_id, title, emoji) VALUES
  ('b5000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Run', '🏃'),
  ('b5000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'Read', '📖'),
  ('b5000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000002', 'Walk', '🚶');

INSERT INTO public.groups (id, name, created_by)
VALUES ('b6000000-0000-4000-8000-000000000001', 'Purge Circle', 'b1000000-0000-4000-8000-000000000001');

INSERT INTO public.group_members (group_id, user_id, role) VALUES
  ('b6000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'admin'),
  ('b6000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'member');

INSERT INTO public.completions (id, user_id, habit_id, completion_type, evidence_url, completed_at) VALUES
  -- A photo only this check-in shows.
  ('b7000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/1000.webp', now() - interval '9 days'),
  -- No media at all.
  ('b7000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'quick',
   NULL, now() - interval '8 days'),
  -- A link to somewhere that is not this project's storage.
  ('b7000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'https://example.com/completions/elsewhere.jpg', now() - interval '7 days'),
  -- One whose photo is about to be taken off it.
  ('b7000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/1004.webp', now() - interval '6 days'),
  -- On Read: one kept private, one from before paths, holding a signed URL.
  ('b7000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002', 'quick',
   NULL, now() - interval '5 days'),
  ('b7000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002', 'photo',
   'https://project.supabase.co/storage/v1/object/sign/completions/b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000002/2000.webp?token=abc.def',
   now() - interval '4 days'),
  -- The friend's own.
  ('b7000000-0000-4000-8000-000000000007', 'b2000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000003', 'photo',
   'b2000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000003/3000.webp', now() - interval '3 days');

INSERT INTO public.completion_private_content (completion_id, user_id, completion_type, evidence_url) VALUES
  ('b7000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/private/secret.webp');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('avatars',       'b1000000-0000-4000-8000-000000000001/avatar.webp'),
  ('avatars',       'b2000000-0000-4000-8000-000000000002/avatar.webp'),
  ('group-avatars', 'b6000000-0000-4000-8000-000000000001/avatar.webp'),
  -- Uploaded, and then the check-in was never sent.
  ('completions',   'b1000000-0000-4000-8000-000000000001/capture/never-attached.webp'),
  ('completions',   'b2000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000003/3000.webp');

CREATE FUNCTION pg_temp.queued(p_bucket text DEFAULT 'completions') RETURNS text[]
LANGUAGE sql AS $fn$
  SELECT coalesce(array_agg(q.path ORDER BY q.path), '{}')
  FROM public.media_purge_queue q WHERE q.bucket = p_bucket;
$fn$;

-- ---------------------------------------------------------------------------
-- Test 1: a stored reference, read as a path in the bucket
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT public.media_storage_path('b1000000-0000-4000-8000-000000000001/capture/a.webp')
         = 'b1000000-0000-4000-8000-000000000001/capture/a.webp', 'TEST 1 FAILED: a path is itself';
  ASSERT public.media_storage_path('https://project.supabase.co/storage/v1/object/sign/completions/b1000000-0000-4000-8000-000000000001/x/2000.webp?token=abc.def')
         = 'b1000000-0000-4000-8000-000000000001/x/2000.webp', 'TEST 1 FAILED: a signed URL is its path';
  ASSERT public.media_storage_path('https://example.com/completions/elsewhere.jpg') IS NULL,
         'TEST 1 FAILED: a link elsewhere is nothing of ours';
  ASSERT public.media_storage_path('https://project.supabase.co/storage/v1/object/sign/avatars/b1000000-0000-4000-8000-000000000001/avatar.webp') IS NULL,
         'TEST 1 FAILED: another bucket is not this one';
  ASSERT public.media_storage_path('capture/a.webp') IS NULL, 'TEST 1 FAILED: a path outside any owner folder';
  ASSERT public.media_storage_path(NULL) IS NULL, 'TEST 1 FAILED: nothing in, nothing out';
  RAISE NOTICE 'TEST 1 PASSED: paths and old signed URLs both name their file';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a check-in's own file is queued with it; no file, nothing queued
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  DELETE FROM public.completions WHERE id IN (
    'b7000000-0000-4000-8000-000000000002',  -- no media
    'b7000000-0000-4000-8000-000000000003'   -- a link elsewhere
  );
  ASSERT pg_temp.queued() = '{}', format('TEST 2 FAILED: queued %s for check-ins with no file', pg_temp.queued());

  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000001';
  ASSERT pg_temp.queued() = ARRAY['b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/1000.webp'],
         format('TEST 2 FAILED: queued %s', pg_temp.queued());
  RAISE NOTICE 'TEST 2 PASSED: deleting a check-in queues its file, and only when it has one';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 3: one capture sent three places is queued when the last one goes
-- ---------------------------------------------------------------------------

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE r JSONB;
BEGIN
  r := public.share_capture(
    'b1000000-0000-4000-8000-000000000001/capture/shared.webp', 'photo', 'sunrise',
    ARRAY['b5000000-0000-4000-8000-000000000001']::uuid[],
    ARRAY['b2000000-0000-4000-8000-000000000002']::uuid[],
    ARRAY['b6000000-0000-4000-8000-000000000001']::uuid[]
  );
  ASSERT jsonb_array_length(r->'completion_ids') = 1
     AND jsonb_array_length(r->'encouragement_ids') = 1
     AND jsonb_array_length(r->'group_message_ids') = 1, 'TEST 3 FAILED: fixture did not reach all three';
END $$;

RESET role;
RESET request.jwt.claims;

DO $$
DECLARE
  v_path CONSTANT text := 'b1000000-0000-4000-8000-000000000001/capture/shared.webp';
BEGIN
  DELETE FROM public.completions WHERE evidence_url = v_path;
  ASSERT pg_temp.queued() = '{}', 'TEST 3 FAILED: queued while the message and the group post still show it';

  DELETE FROM public.encouragements WHERE media_path = v_path;
  ASSERT pg_temp.queued() = '{}', 'TEST 3 FAILED: queued while the group post still shows it';

  DELETE FROM public.group_messages WHERE media_path = v_path;
  ASSERT pg_temp.queued() = ARRAY[v_path], format('TEST 3 FAILED: queued %s once nothing showed it', pg_temp.queued());
  RAISE NOTICE 'TEST 3 PASSED: a shared capture is queued only when its last row goes';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 4: a row that stops pointing at a file counts as letting go of it
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_path CONSTANT text := 'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/1004.webp';
BEGIN
  UPDATE public.completions SET notes = 'edited' WHERE id = 'b7000000-0000-4000-8000-000000000004';
  UPDATE public.completions SET evidence_url = v_path WHERE id = 'b7000000-0000-4000-8000-000000000004';
  ASSERT pg_temp.queued() = '{}', 'TEST 4 FAILED: queued a file its row still points at';

  UPDATE public.completions SET evidence_url = NULL WHERE id = 'b7000000-0000-4000-8000-000000000004';
  ASSERT pg_temp.queued() = ARRAY[v_path], format('TEST 4 FAILED: queued %s', pg_temp.queued());
  RAISE NOTICE 'TEST 4 PASSED: taking a file off a row queues it';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 5: deleting a habit queues every file its check-ins held
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  DELETE FROM public.habits WHERE id = 'b5000000-0000-4000-8000-000000000002';

  ASSERT pg_temp.queued() = ARRAY[
    -- from the signed URL an old check-in held
    'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000002/2000.webp',
    -- kept private, in its own table
    'b1000000-0000-4000-8000-000000000001/private/secret.webp'
  ], format('TEST 5 FAILED: queued %s', pg_temp.queued());
  RAISE NOTICE 'TEST 5 PASSED: a deleted habit takes its photos with it, private and old ones too';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 6: a file an old signed URL still points at is not queued
-- ---------------------------------------------------------------------------

INSERT INTO public.completions (id, user_id, habit_id, completion_type, evidence_url, completed_at) VALUES
  ('b7000000-0000-4000-8000-000000000011', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/capture/twice.webp', now() - interval '2 days'),
  ('b7000000-0000-4000-8000-000000000012', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'http://127.0.0.1:54321/storage/v1/object/sign/completions/b1000000-0000-4000-8000-000000000001/capture/twice.webp?token=old',
   now() - interval '1 day');

DO $$
BEGIN
  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000011';
  ASSERT pg_temp.queued() = '{}', 'TEST 6 FAILED: queued a file a signed URL still points at';

  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000012';
  ASSERT pg_temp.queued() = ARRAY['b1000000-0000-4000-8000-000000000001/capture/twice.webp'],
         format('TEST 6 FAILED: queued %s', pg_temp.queued());
  RAISE NOTICE 'TEST 6 PASSED: a path and a signed URL to the same file count as one';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 7: a row pointing into someone else's folder neither frees their file nor holds it
-- ---------------------------------------------------------------------------
-- Nothing stops the friend writing the owner's path into a check-in of their
-- own. Deleting that row must not take the owner's file with it, and keeping
-- it must not pin a file the owner has deleted.

INSERT INTO public.completions (id, user_id, habit_id, completion_type, evidence_url, completed_at) VALUES
  -- The owner's photo, and the friend's row claiming the same file.
  ('b7000000-0000-4000-8000-000000000041', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/capture/mine.webp', now() - interval '30 hours'),
  ('b7000000-0000-4000-8000-000000000042', 'b2000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000003', 'photo',
   'b1000000-0000-4000-8000-000000000001/capture/mine.webp', now() - interval '29 hours'),
  -- The friend's row pointing at a file of the owner's that no row of the owner's shows.
  ('b7000000-0000-4000-8000-000000000043', 'b2000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000003', 'photo',
   'b1000000-0000-4000-8000-000000000001/capture/never-attached.webp', now() - interval '28 hours');

DO $$
BEGIN
  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000043';
  ASSERT pg_temp.queued() = '{}',
         format('TEST 7 FAILED: deleting a row of the friend''s queued the owner''s file %s', pg_temp.queued());

  -- The owner deletes theirs; the friend's row still points at the file.
  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000041';
  ASSERT pg_temp.queued() = ARRAY['b1000000-0000-4000-8000-000000000001/capture/mine.webp'],
         format('TEST 7 FAILED: someone else''s row held the owner''s deleted file back (queued %s)', pg_temp.queued());

  DELETE FROM public.media_purge_queue;
  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000042';
  ASSERT pg_temp.queued() = '{}', 'TEST 7 FAILED: the friend''s row released a file that was never theirs';

  RAISE NOTICE 'TEST 7 PASSED: only a file''s owner can hold it or let it go';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 8: work comes off the queue once, and not if it is wanted again
-- ---------------------------------------------------------------------------

INSERT INTO public.media_purge_queue (bucket, path, queued_at) VALUES
  ('completions', 'b1000000-0000-4000-8000-000000000001/capture/gone-1.webp', now() - interval '3 minutes'),
  ('completions', 'b1000000-0000-4000-8000-000000000001/capture/gone-2.webp', now() - interval '2 minutes'),
  -- The friend's check-in still shows this one: queued by mistake, or sent again since.
  ('completions', 'b2000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000003/3000.webp', now() - interval '1 minute'),
  ('avatars',     'b1000000-0000-4000-8000-000000000009/avatar.webp', now());

DO $$
DECLARE
  v_claimed text[];
  v_done integer;
BEGIN
  SELECT array_agg(c.bucket || ':' || c.path ORDER BY c.bucket, c.path) INTO v_claimed
  FROM public.claim_media_purge(10) c;

  ASSERT v_claimed = ARRAY[
    'avatars:b1000000-0000-4000-8000-000000000009/avatar.webp',
    'completions:b1000000-0000-4000-8000-000000000001/capture/gone-1.webp',
    'completions:b1000000-0000-4000-8000-000000000001/capture/gone-2.webp'
  ], format('TEST 8 FAILED: claimed %s', v_claimed);

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.media_purge_queue
    WHERE path = 'b2000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000003/3000.webp'
  ), 'TEST 8 FAILED: a file a check-in still shows stayed on the queue';

  ASSERT (SELECT bool_and(attempts = 1 AND last_attempt_at IS NOT NULL) FROM public.media_purge_queue),
         'TEST 8 FAILED: a claimed entry was not marked tried';

  -- Tried a moment ago: not handed out again until it is due.
  ASSERT (SELECT count(*) FROM public.claim_media_purge(10)) = 0, 'TEST 8 FAILED: the same work was handed out twice';

  -- One removal failed and one worked.
  v_done := public.finish_media_purge(
    'completions', ARRAY['b1000000-0000-4000-8000-000000000001/capture/gone-1.webp']
  );
  ASSERT v_done = 1, format('TEST 8 FAILED: finished %s', v_done);

  UPDATE public.media_purge_queue SET last_attempt_at = now() - interval '11 minutes';
  SELECT array_agg(c.bucket || ':' || c.path ORDER BY c.bucket, c.path) INTO v_claimed
  FROM public.claim_media_purge(1) c;
  ASSERT v_claimed = ARRAY['completions:b1000000-0000-4000-8000-000000000001/capture/gone-2.webp'],
         format('TEST 8 FAILED: second round claimed %s, oldest first and one at a time', v_claimed);
  ASSERT (SELECT attempts FROM public.media_purge_queue WHERE path LIKE '%gone-2.webp') = 2,
         'TEST 8 FAILED: the second try was not counted';

  RAISE NOTICE 'TEST 8 PASSED: claimed once, retried when due, dropped when wanted again';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 9: the queue and its helpers are the service role's alone
-- ---------------------------------------------------------------------------

INSERT INTO public.media_purge_queue (bucket, path)
VALUES ('completions', 'b1000000-0000-4000-8000-000000000001/capture/private-to-the-service.webp');

SET LOCAL role TO anon;

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT count(*) FROM public.media_purge_queue$q$,
    $q$INSERT INTO public.media_purge_queue (bucket, path) VALUES ('avatars', 'b2000000-0000-4000-8000-000000000002/avatar.webp')$q$,
    $q$SELECT * FROM public.claim_media_purge(10)$q$,
    $q$SELECT public.finish_media_purge('completions', ARRAY['x'])$q$,
    $q$SELECT public.media_is_referenced('b2000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000003/3000.webp')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 9 FAILED: anon could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

RESET role;
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"b2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE
  call TEXT;
BEGIN
  FOREACH call IN ARRAY ARRAY[
    $q$SELECT count(*) FROM public.media_purge_queue$q$,
    -- Queueing someone else's avatar would be a way to delete it.
    $q$INSERT INTO public.media_purge_queue (bucket, path) VALUES ('avatars', 'b1000000-0000-4000-8000-000000000001/avatar.webp')$q$,
    $q$SELECT * FROM public.claim_media_purge(10)$q$,
    $q$SELECT public.finish_media_purge('completions', ARRAY['x'])$q$,
    $q$SELECT public.media_is_referenced('b1000000-0000-4000-8000-000000000001/private/secret.webp')$q$
  ] LOOP
    BEGIN
      EXECUTE call;
      RAISE EXCEPTION 'TEST 9 FAILED: a signed-in user could run %', call;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

RESET role;
RESET request.jwt.claims;
SET LOCAL role TO service_role;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.claim_media_purge(10)) = 1, 'TEST 9 FAILED: the service role could not claim';
  ASSERT public.finish_media_purge(
    'completions', ARRAY['b1000000-0000-4000-8000-000000000001/capture/private-to-the-service.webp']
  ) = 1, 'TEST 9 FAILED: the service role could not finish';
  RAISE NOTICE 'TEST 9 PASSED: only the service role reads the queue or takes work off it';
END $$;

RESET role;

-- ---------------------------------------------------------------------------
-- Test 10: a delete goes through even when the queue cannot take it
-- ---------------------------------------------------------------------------

ALTER TABLE public.media_purge_queue ADD CONSTRAINT chk_test_refuses_everything CHECK (false) NOT VALID;

INSERT INTO public.completions (id, user_id, habit_id, completion_type, evidence_url, completed_at) VALUES
  ('b7000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/capture/unqueueable.webp', now() - interval '12 hours');

DO $$
BEGIN
  DELETE FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000021';
  ASSERT NOT EXISTS (SELECT 1 FROM public.completions WHERE id = 'b7000000-0000-4000-8000-000000000021'),
         'TEST 10 FAILED: the check-in is still there';
  ASSERT pg_temp.queued() = '{}', 'TEST 10 FAILED: the broken queue took a row anyway';
  RAISE NOTICE 'TEST 10 PASSED: a failure to queue never blocks the delete';
END $$;

ALTER TABLE public.media_purge_queue DROP CONSTRAINT chk_test_refuses_everything;

-- ---------------------------------------------------------------------------
-- Test 11: deleting an account queues everything in its folders
-- ---------------------------------------------------------------------------

-- One more photo, so there is a file a row still points at when the account goes.
INSERT INTO public.completions (id, user_id, habit_id, completion_type, evidence_url, completed_at) VALUES
  ('b7000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'photo',
   'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/1031.webp', now() - interval '1 hour');

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT public.delete_own_account('b1000000-0000-4000-8000-000000000001');

RESET role;
RESET request.jwt.claims;

DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'b1000000-0000-4000-8000-000000000001'),
         'TEST 11 FAILED: the account is still there';

  ASSERT pg_temp.queued('completions') = ARRAY[
    -- a check-in pointed at it
    'b1000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/1031.webp',
    -- nothing ever did, and it is still theirs
    'b1000000-0000-4000-8000-000000000001/capture/never-attached.webp'
  ], format('TEST 11 FAILED: queued %s', pg_temp.queued('completions'));

  ASSERT pg_temp.queued('avatars') = ARRAY['b1000000-0000-4000-8000-000000000001/avatar.webp'],
         format('TEST 11 FAILED: queued avatars %s', pg_temp.queued('avatars'));

  -- The group went to the friend, so its picture stays.
  ASSERT pg_temp.queued('group-avatars') = '{}', 'TEST 11 FAILED: queued the picture of a group that lives on';
  ASSERT EXISTS (SELECT 1 FROM public.groups WHERE id = 'b6000000-0000-4000-8000-000000000001'),
         'TEST 11 FAILED: fixture: the group should have been handed to the friend';

  RAISE NOTICE 'TEST 11 PASSED: a deleted account queues its avatar and every file in its folder, and nobody else''s';
END $$;

DELETE FROM public.media_purge_queue;

-- ---------------------------------------------------------------------------
-- Test 12: deleting a group queues its picture and what was posted in it
-- ---------------------------------------------------------------------------

INSERT INTO public.group_messages (group_id, user_id, content, media_path, media_type) VALUES
  ('b6000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'look',
   'b2000000-0000-4000-8000-000000000002/capture/posted.webp', 'photo'),
  -- Also the friend's check-in photo, posted to the group as well.
  ('b6000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', NULL,
   'b2000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000003/3000.webp', 'photo');

DO $$
BEGIN
  DELETE FROM public.groups WHERE id = 'b6000000-0000-4000-8000-000000000001';

  ASSERT pg_temp.queued('group-avatars') = ARRAY['b6000000-0000-4000-8000-000000000001/avatar.webp'],
         format('TEST 12 FAILED: queued group pictures %s', pg_temp.queued('group-avatars'));
  -- The check-in still shows its photo; only the one posted nowhere else goes.
  ASSERT pg_temp.queued('completions') = ARRAY['b2000000-0000-4000-8000-000000000002/capture/posted.webp'],
         format('TEST 12 FAILED: queued %s', pg_temp.queued('completions'));
  ASSERT pg_temp.queued('avatars') = '{}', 'TEST 12 FAILED: queued a member''s avatar';

  RAISE NOTICE 'TEST 12 PASSED: a deleted group takes its picture and its own posts, not its members'' check-ins';
  RAISE NOTICE '=== ALL MEDIA PURGE TESTS PASSED ===';
END $$;

ROLLBACK;
