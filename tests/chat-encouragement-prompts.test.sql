-- =============================================================================
-- Who in a chat could use a word (migration 053)
-- =============================================================================
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/chat-encouragement-prompts.test.sql
--
-- get_chat_late_habits lists, for one chat or every friend's at once (the
-- inbox), the other side's habits that could use a word from the viewer:
-- "remind" once today's window has closed with nothing logged, by the owner's
-- clock, and "encourage" through the next day once a day ends unlogged. One
-- row per habit, its latest day. Writing in the chat since the window closed
-- answers it.
--
-- Times are on Thursday 8 October 2026, UTC unless a test says otherwise.
-- Every habit was checked in on Wednesday except the ones a test needs
-- missed. Everything is rolled back at the end.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- What a viewer's chat would list at a moment, as "kind:Title", in order.
CREATE FUNCTION public._late(p_viewer UUID, p_friend UUID, p_group UUID, p_at TIMESTAMPTZ)
RETURNS TEXT[]
LANGUAGE plpgsql AS $fn$
DECLARE
  v TEXT[];
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_viewer, 'role', 'authenticated')::text, true);
  SELECT coalesce(array_agg(l.kind || ':' || l.title ORDER BY l.n), '{}') INTO v
  FROM public.get_chat_late_habits(p_friend, p_group, p_at) WITH ORDINALITY
       AS l(habit_id, title, emoji, color, owner_id, owner_name, owner_avatar, kind, day, closed_at, n);
  RETURN v;
END;
$fn$;

-- What a viewer's inbox would list, every friend's chat at once, as
-- "Owner:kind:Title".
CREATE FUNCTION public._inbox(p_viewer UUID, p_at TIMESTAMPTZ)
RETURNS TEXT[]
LANGUAGE plpgsql AS $fn$
DECLARE
  v TEXT[];
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_viewer, 'role', 'authenticated')::text, true);
  SELECT coalesce(array_agg(l.owner_name || ':' || l.kind || ':' || l.title ORDER BY l.n), '{}') INTO v
  FROM public.get_chat_late_habits(NULL, NULL, p_at) WITH ORDINALITY
       AS l(habit_id, title, emoji, color, owner_id, owner_name, owner_avatar, kind, day, closed_at, n);
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- olive     keeps most habits, in UTC
-- pat       partners on olive's and cora's, and is in Crew: the viewer
-- sam       keeps Crew's other habits
-- cora      keeps one habit, in Chicago (UTC-5 in October)
-- stranger  no relationship to anyone
-- newt      becomes olive's partner, and joins Crew, partway through Thursday

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'cep-' || u.name || '@test.com', crypt('pw', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('username', 'cep_' || u.name), now(), now()
FROM (VALUES
  ('ce000000-0000-4000-8000-000000000001', 'olive'),
  ('ce000000-0000-4000-8000-000000000002', 'pat'),
  ('ce000000-0000-4000-8000-000000000003', 'sam'),
  ('ce000000-0000-4000-8000-000000000004', 'cora'),
  ('ce000000-0000-4000-8000-000000000005', 'stranger'),
  ('ce000000-0000-4000-8000-000000000006', 'newt')
) AS u(id, name);

UPDATE public.profiles SET timezone = 'UTC', notification_prefs = '{}'::jsonb,
  display_name = initcap(substr(username, 5))
WHERE id::text LIKE 'ce000000-%';
UPDATE public.profiles SET timezone = 'America/Chicago'
WHERE id = 'ce000000-0000-4000-8000-000000000004';

INSERT INTO public.habits (id, user_id, title, frequency, schedule, time_window, is_paused, created_at)
SELECT h.id::uuid, h.owner::uuid, h.title, 'daily', h.schedule::jsonb, h.tw::jsonb, h.paused,
       '2026-10-01 00:00+00'
FROM (VALUES
  ('cf000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'Run',      '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', 'Read',     '{"days":[0,1,2,3,4,5,6]}', '{"start":"10:00","end":"11:00"}', false),
  ('cf000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000001', 'Pray',     '{"days":[0,1,2,3,4,5,6]}', NULL,                              false),
  ('cf000000-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-000000000001', 'Asked',    '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000001', 'Resting',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', true),
  ('cf000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000001', 'Day off',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-000000000007', 'ce000000-0000-4000-8000-000000000001', 'Moved',    '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-000000000008', 'ce000000-0000-4000-8000-000000000001', 'Weekdays', '{"days":[1,2,3,5]}',       '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-000000000009', 'ce000000-0000-4000-8000-000000000001', 'Done',     '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-00000000000a', 'ce000000-0000-4000-8000-000000000001', 'Rained',   '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-00000000000b', 'ce000000-0000-4000-8000-000000000004', 'Chicago',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-00000000000c', 'ce000000-0000-4000-8000-000000000001', 'Slipped',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-00000000000d', 'ce000000-0000-4000-8000-000000000001', 'Back on track', '{"days":[0,1,2,3,4,5,6]}', '{"start":"08:00","end":"09:00"}', false),
  ('cf000000-0000-4000-8000-000000000010', 'ce000000-0000-4000-8000-000000000003', 'Stretch',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"06:00","end":"07:00"}', false),
  ('cf000000-0000-4000-8000-000000000011', 'ce000000-0000-4000-8000-000000000003', 'Plank',    '{"days":[0,1,2,3,4,5,6]}', '{"start":"06:00","end":"07:00"}', false),
  ('cf000000-0000-4000-8000-000000000012', 'ce000000-0000-4000-8000-000000000001', 'Walk',     '{"days":[0,1,2,3,4,5,6]}', '{"start":"07:30","end":"08:00"}', false),
  ('cf000000-0000-4000-8000-000000000013', 'ce000000-0000-4000-8000-000000000002', 'Mine',     '{"days":[0,1,2,3,4,5,6]}', '{"start":"06:00","end":"07:00"}', false),
  ('cf000000-0000-4000-8000-000000000014', 'ce000000-0000-4000-8000-000000000003', 'Old challenge', '{"days":[0,1,2,3,4,5,6]}', '{"start":"06:00","end":"07:00"}', false),
  ('cf000000-0000-4000-8000-000000000015', 'ce000000-0000-4000-8000-000000000003', 'Skipped',  '{"days":[0,1,2,3,4,5,6]}', '{"start":"06:00","end":"07:00"}', false)
) AS h(id, owner, title, schedule, tw, paused);

-- Wednesday kept, by each owner's clock, except where a test needs it missed.
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
SELECT h.id, h.user_id, 'quick',
       CASE WHEN h.title = 'Chicago' THEN '2026-10-07 18:00+00' ELSE '2026-10-07 12:00+00' END::timestamptz
FROM public.habits h
WHERE h.id::text LIKE 'cf000000-%'
  AND h.title NOT IN ('Slipped', 'Back on track', 'Skipped');

-- Set after its window closed on Thursday: there was no window to miss.
UPDATE public.habits SET timing_changed_at = '2026-10-08 09:30+00'
WHERE id = 'cf000000-0000-4000-8000-000000000007';

-- Paused for Thursday alone.
INSERT INTO public.habit_pauses (habit_id, started_on, ended_on)
VALUES ('cf000000-0000-4000-8000-000000000006', '2026-10-08', '2026-10-09');

-- Pat partners on all of olive's and cora's, one still only asked. Walk is
-- Crew's alone.
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at, responded_at)
SELECT h.id, 'ce000000-0000-4000-8000-000000000002',
       CASE WHEN h.title = 'Asked' THEN 'pending' ELSE 'accepted' END::habit_partner_status,
       h.user_id, '2026-10-01 00:00+00',
       CASE WHEN h.title = 'Asked' THEN NULL ELSE '2026-10-01 00:00+00'::timestamptz END
FROM public.habits h
WHERE h.id::text LIKE 'cf000000-%' AND h.user_id IN ('ce000000-0000-4000-8000-000000000001',
                                                     'ce000000-0000-4000-8000-000000000004')
  AND h.title <> 'Walk';

-- Newt says yes to Run at 9:30, after its window closed.
INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by, created_at, responded_at)
VALUES ('cf000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000006', 'accepted',
        'ce000000-0000-4000-8000-000000000001', '2026-10-08 09:00+00', '2026-10-08 09:30+00');

-- Thursday: Done checked in, Rained rain-checked, Back on track checked in
-- again after missing Wednesday.
INSERT INTO public.completions (id, habit_id, user_id, completion_type, completed_at)
VALUES ('c0000000-0000-4000-8000-000000000001', 'cf000000-0000-4000-8000-000000000009',
        'ce000000-0000-4000-8000-000000000001', 'quick', '2026-10-08 08:30+00');
INSERT INTO public.completions (habit_id, user_id, completion_type, rain_check_reason, completed_at)
VALUES ('cf000000-0000-4000-8000-00000000000a', 'ce000000-0000-4000-8000-000000000001',
        'rain_check', 'sick', '2026-10-08 07:00+00');
INSERT INTO public.completions (habit_id, user_id, completion_type, completed_at)
VALUES ('cf000000-0000-4000-8000-00000000000d', 'ce000000-0000-4000-8000-000000000001',
        'quick', '2026-10-08 07:30+00');

-- Crew: olive, pat and sam from the start, newt from 8:30 on Thursday.
INSERT INTO public.groups (id, name, created_by)
VALUES ('cd000000-0000-4000-8000-000000000001', 'Crew', 'ce000000-0000-4000-8000-000000000001');
INSERT INTO public.group_members (group_id, user_id, role, joined_at)
VALUES
  ('cd000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'admin',  '2026-10-01 00:00+00'),
  ('cd000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'member', '2026-10-01 00:00+00'),
  ('cd000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 'member', '2026-10-01 00:00+00'),
  ('cd000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000006', 'member', '2026-10-08 08:30+00');

INSERT INTO public.group_habit_shares (group_id, habit_id, shared_by, created_at)
SELECT 'cd000000-0000-4000-8000-000000000001', h.id, h.user_id, '2026-10-01 00:00+00'
FROM public.habits h
WHERE h.title IN ('Stretch', 'Plank', 'Walk', 'Mine', 'Skipped') AND h.id::text LIKE 'cf000000-%';

-- Plank is shared with Crew and kept for its live challenge too. Old
-- challenge's challenge is over.
INSERT INTO public.group_challenges (id, group_id, title, created_by, is_active)
VALUES
  ('cc000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', 'Core month', 'ce000000-0000-4000-8000-000000000003', true),
  ('cc000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000001', 'Last spring', 'ce000000-0000-4000-8000-000000000003', false);
INSERT INTO public.group_challenge_participants (challenge_id, user_id, habit_id, joined_at)
VALUES
  ('cc000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000011', '2026-10-01 00:00+00'),
  ('cc000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 'cf000000-0000-4000-8000-000000000014', '2026-10-01 00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: a friend's chat, by the owner's clock
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  pat   CONSTANT UUID := 'ce000000-0000-4000-8000-000000000002';
  olive CONSTANT UUID := 'ce000000-0000-4000-8000-000000000001';
  cora  CONSTANT UUID := 'ce000000-0000-4000-8000-000000000004';
BEGIN
  ASSERT public._late(pat, olive, NULL, '2026-10-08 08:30+00') = ARRAY['encourage:Slipped'],
    format('TEST 1a FAILED: at 8:30 only Wednesday''s miss of Slipped, got %s',
           public._late(pat, olive, NULL, '2026-10-08 08:30+00'));
  RAISE NOTICE 'TEST 1a PASSED: a day missed is there to encourage the next day, and not once they''ve checked in again';

  ASSERT public._late(pat, olive, NULL, '2026-10-08 09:00+00') = ARRAY['remind:Run', 'remind:Slipped'],
    format('TEST 1b FAILED: at 9:00 Run and Slipped to remind, got %s',
           public._late(pat, olive, NULL, '2026-10-08 09:00+00'));
  RAISE NOTICE 'TEST 1b PASSED: to remind the moment a window closes, standing in for yesterday''s miss; not without a window, asked only, paused, on a paused day, set after, off the schedule, checked in or rain-checked';

  ASSERT public._late(pat, olive, NULL, '2026-10-08 11:30+00') = ARRAY['remind:Run', 'remind:Slipped', 'remind:Read'],
    format('TEST 1c FAILED: at 11:30 Run, Slipped then Read, got %s',
           public._late(pat, olive, NULL, '2026-10-08 11:30+00'));
  RAISE NOTICE 'TEST 1c PASSED: several at once come back together, by when they closed';

  -- Chicago is UTC-5 in October: 9 AM there is 14:00 UTC.
  ASSERT public._late(pat, cora, NULL, '2026-10-08 13:59+00') = '{}',
    'TEST 1d FAILED: Chicago was late before 9 AM in Chicago';
  ASSERT public._late(pat, cora, NULL, '2026-10-08 14:00+00') = ARRAY['remind:Chicago'],
    'TEST 1d FAILED: Chicago should be one to remind at 9 AM in Chicago';
  ASSERT public._late(pat, cora, NULL, '2026-10-09 04:00+00') = ARRAY['remind:Chicago'],
    'TEST 1d FAILED: at 11 PM in Chicago it is still her Thursday, and still one to remind';
  ASSERT public._late(pat, cora, NULL, '2026-10-09 05:30+00') = ARRAY['encourage:Chicago'],
    'TEST 1d FAILED: after midnight in Chicago her Thursday is missed, one to encourage';
  ASSERT public._late(pat, cora, NULL, '2026-10-09 14:00+00') = ARRAY['remind:Chicago'],
    'TEST 1d FAILED: once Friday''s window closes too, Friday''s reminder stands in for Thursday';
  RAISE NOTICE 'TEST 1d PASSED: by the owner''s clock and day, whatever the viewer''s';

  ASSERT public._late(olive, pat, NULL, '2026-10-08 11:30+00') = '{}',
    'TEST 1e FAILED: olive does not partner on any of pat''s habits';
  RAISE NOTICE 'TEST 1e PASSED: only the habits you partner on, not the other way round';

  ASSERT public._inbox(pat, '2026-10-08 14:30+00')
         = ARRAY['Cora:remind:Chicago', 'Olive:remind:Run', 'Olive:remind:Slipped', 'Olive:remind:Read'],
    format('TEST 1f FAILED: pat''s inbox should be every friend''s chat, got %s',
           public._inbox(pat, '2026-10-08 14:30+00'));
  RAISE NOTICE 'TEST 1f PASSED: with no chat named, every friend''s at once, each person''s together; a group''s habits are not in it';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: answered by writing to them
-- ---------------------------------------------------------------------------

-- A heart on Done's check-in at 9:30 isn't an answer.
INSERT INTO public.encouragements (user_id, recipient_id, encouragement_type, content, completion_id, created_at)
VALUES ('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', 'emoji', '❤️',
        'c0000000-0000-4000-8000-000000000001', '2026-10-08 09:30+00');

DO $$
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 09:45+00')
         = ARRAY['remind:Run', 'remind:Slipped'],
    'TEST 2a FAILED: a heart on an earlier check-in answered Run';
  RAISE NOTICE 'TEST 2a PASSED: a heart is not an answer';
END $$;

-- A message at 10:00 answers Run and Slipped, closed at 9:00, and not Read,
-- closed at 11:00.
INSERT INTO public.encouragements (user_id, recipient_id, encouragement_type, content, created_at)
VALUES ('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', 'message',
        'How did the run go?', '2026-10-08 10:00+00');

DO $$
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 10:30+00') = '{}',
    'TEST 2b FAILED: Run and Slipped were still listed after a message sent since they closed';
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 11:30+00') = ARRAY['remind:Read'],
    format('TEST 2b FAILED: Read closed after the message and should be listed, got %s',
           public._late('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 11:30+00'));
  ASSERT public._inbox('ce000000-0000-4000-8000-000000000002', '2026-10-08 11:30+00') = ARRAY['Olive:remind:Read'],
    'TEST 2b FAILED: the inbox still listed what the message answered';
  RAISE NOTICE 'TEST 2b PASSED: a message answers what had gone late by then, in the chat and the inbox, and a habit late after it asks again';
END $$;

-- A message from olive to pat answers nothing of pat's.
INSERT INTO public.encouragements (user_id, recipient_id, encouragement_type, content, created_at)
VALUES ('ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'message',
        'Hey', '2026-10-08 11:15+00');

DO $$
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 11:30+00') = ARRAY['remind:Read'],
    'TEST 2c FAILED: a message from olive answered pat''s';
  RAISE NOTICE 'TEST 2c PASSED: only what the viewer writes answers it';
END $$;

-- Pat writes to cora early Friday, after her Thursday was missed.
INSERT INTO public.encouragements (user_id, recipient_id, encouragement_type, content, created_at)
VALUES ('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004', 'message',
        'Thinking of you', '2026-10-09 05:45+00');

DO $$
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000004', NULL, '2026-10-09 06:00+00') = '{}',
    'TEST 2d FAILED: a message after the miss did not answer it';
  RAISE NOTICE 'TEST 2d PASSED: a missed day is answered the same way';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a partner from after the window closed
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 10:00+00') = '{}',
    'TEST 3 FAILED: newt became a partner at 9:30 and was shown Run, closed at 9:00';
  RAISE NOTICE 'TEST 3 PASSED: a window that closed before you were a partner is not yours to answer';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: a group's chat
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  crew CONSTANT UUID := 'cd000000-0000-4000-8000-000000000001';
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', NULL, crew, '2026-10-08 06:30+00') = ARRAY['encourage:Skipped'],
    format('TEST 4a FAILED: at 6:30 only Sam''s Wednesday miss of Skipped, got %s',
           public._late('ce000000-0000-4000-8000-000000000002', NULL, crew, '2026-10-08 06:30+00'));
  RAISE NOTICE 'TEST 4a PASSED: a group''s missed days too';

  ASSERT public._late('ce000000-0000-4000-8000-000000000002', NULL, crew, '2026-10-08 08:30+00')
         = ARRAY['remind:Walk', 'remind:Plank', 'remind:Skipped', 'remind:Stretch'],
    format('TEST 4b FAILED: pat should see Olive''s Walk, then Sam''s Plank, Skipped, Stretch, got %s',
           public._late('ce000000-0000-4000-8000-000000000002', NULL, crew, '2026-10-08 08:30+00'));
  RAISE NOTICE 'TEST 4b PASSED: shared and live-challenge habits, once each, person by person; not your own, not an ended challenge''s';

  ASSERT public._late('ce000000-0000-4000-8000-000000000001', NULL, crew, '2026-10-08 08:30+00')
         = ARRAY['remind:Mine', 'remind:Plank', 'remind:Skipped', 'remind:Stretch'],
    format('TEST 4c FAILED: olive should see pat''s and sam''s, not her own Walk, got %s',
           public._late('ce000000-0000-4000-8000-000000000001', NULL, crew, '2026-10-08 08:30+00'));
  RAISE NOTICE 'TEST 4c PASSED: each member sees everyone else''s';

  ASSERT public._late('ce000000-0000-4000-8000-000000000006', NULL, crew, '2026-10-08 09:00+00') = '{}',
    'TEST 4d FAILED: newt joined at 8:30 and was shown windows closed before';
  RAISE NOTICE 'TEST 4d PASSED: a window that closed before you joined is not yours to answer';

  ASSERT public._late('ce000000-0000-4000-8000-000000000005', NULL, crew, '2026-10-08 08:30+00') = '{}',
    'TEST 4e FAILED: someone outside Crew was shown its habits';
  ASSERT public._late('ce000000-0000-4000-8000-000000000005', 'ce000000-0000-4000-8000-000000000001', NULL, '2026-10-08 11:30+00') = '{}',
    'TEST 4e FAILED: a stranger was shown olive''s habits';
  ASSERT public._inbox('ce000000-0000-4000-8000-000000000005', '2026-10-08 11:30+00') = '{}',
    'TEST 4e FAILED: a stranger''s inbox listed someone''s habits';
  RAISE NOTICE 'TEST 4e PASSED: nothing for someone outside the group, or who partners on nothing';
END $$;

-- Pat writes in Crew at 7:30: after Stretch, Plank and Skipped closed, before Walk.
INSERT INTO public.group_messages (group_id, user_id, content, created_at)
VALUES ('cd000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
        'Morning, all', '2026-10-08 07:30+00');

DO $$
BEGIN
  ASSERT public._late('ce000000-0000-4000-8000-000000000002', NULL, 'cd000000-0000-4000-8000-000000000001', '2026-10-08 08:30+00') = ARRAY['remind:Walk'],
    format('TEST 4f FAILED: after pat wrote at 7:30 only Walk should be left, got %s',
           public._late('ce000000-0000-4000-8000-000000000002', NULL, 'cd000000-0000-4000-8000-000000000001', '2026-10-08 08:30+00'));
  ASSERT public._late('ce000000-0000-4000-8000-000000000001', NULL, 'cd000000-0000-4000-8000-000000000001', '2026-10-08 08:30+00')
         = ARRAY['remind:Mine', 'remind:Plank', 'remind:Skipped', 'remind:Stretch'],
    'TEST 4f FAILED: pat writing answered olive''s list too';
  RAISE NOTICE 'TEST 4f PASSED: writing in the group answers what had gone late by then, for you alone';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: who may call it
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.get_chat_late_habits(uuid, uuid, timestamptz)', 'EXECUTE'),
    'TEST 5 FAILED: a signed-in user cannot call get_chat_late_habits';
  ASSERT NOT has_function_privilege('anon', 'public.get_chat_late_habits(uuid, uuid, timestamptz)', 'EXECUTE'),
    'TEST 5 FAILED: anon can call get_chat_late_habits';
  RAISE NOTICE 'TEST 5 PASSED: signed in only';
END $$;

ROLLBACK;
