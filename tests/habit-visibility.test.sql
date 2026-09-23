-- =============================================================================
-- Habit visibility + partner handshake tests (migration 029)
-- =============================================================================
-- Run against a local Supabase instance:
--   psql "postgresql://postgres:postgres@localhost:54322/postgres" -f tests/habit-visibility.test.sql
--
-- Two questions are being asked throughout:
--
--   1. Does a habit_shares row that is NOT accepted grant anything? It must not
--      — not the habit, not its completions, not its evidence media. That is
--      the whole point of making partnership a handshake, and it is the thing
--      the 029 read-path sweep can silently get wrong.
--
--   2. Does `public` leak more than it promises? A public habit is discoverable
--      by friends and says what it is called. The streak arrives with the
--      partnership, not with the visibility.
--
-- Uses its own users and its own uuid prefix, so it runs against a seeded
-- database without colliding with seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------------------
-- alice  owns the habits
-- bob    friend of alice — the partner under test
-- carol  friend of alice — a friend who is NOT a partner
-- dave   no friendship with anyone

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-alice@test.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-bob@test.com',   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-carol@test.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('a4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-dave@test.com',  crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

-- handle_new_user() already made a profile for each of them, so these are
-- updates rather than inserts.
UPDATE public.profiles SET display_name = 'Vis Alice', username = 'vis_alice' WHERE id = 'a1000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET display_name = 'Vis Bob',   username = 'vis_bob'   WHERE id = 'a2000000-0000-4000-8000-000000000002';
UPDATE public.profiles SET display_name = 'Vis Carol', username = 'vis_carol' WHERE id = 'a3000000-0000-4000-8000-000000000003';
UPDATE public.profiles SET display_name = 'Vis Dave',  username = 'vis_dave'  WHERE id = 'a4000000-0000-4000-8000-000000000004';

INSERT INTO public.friendships (register_id, addressee_id, status) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'accepted'),
  ('a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'accepted');

-- b…01 private, b…02 public. Both alice's.
INSERT INTO public.habits (id, user_id, title, emoji, visibility, streak_current, streak_best) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Private Run',  '🏃', 'private', 7, 9),
  ('b0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Public Reading', '📚', 'public', 5, 11);

INSERT INTO public.completions (id, user_id, habit_id, completion_type) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'quick'),
  ('c0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'quick');

-- Evidence media, one object per habit, laid out as the app does:
-- <owner id>/<habit id>/<file>
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('completions', 'a1000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/private.jpg', 'a1000000-0000-4000-8000-000000000001'),
  ('completions', 'a1000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000002/public.jpg',  'a1000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Test 1: the backfill
-- ---------------------------------------------------------------------------

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.habits WHERE visibility <> 'private' AND created_at < now() - interval '1 second';
  ASSERT n = 0, 'TEST 1a FAILED: pre-existing habits should all have been made private';
  RAISE NOTICE 'TEST 1a PASSED: backfill left every pre-existing habit private';

  SELECT count(*) INTO n FROM public.habit_shares WHERE status IS NULL OR initiated_by IS NULL;
  ASSERT n = 0, 'TEST 1b FAILED: backfill left habit_shares rows without a status or initiator';
  RAISE NOTICE 'TEST 1b PASSED: every pre-existing share has a status and an initiator';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: a PENDING share grants nothing
-- ---------------------------------------------------------------------------

INSERT INTO public.habit_shares (id, habit_id, shared_with, status, initiated_by)
VALUES ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'pending', 'a1000000-0000-4000-8000-000000000001');

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.habits WHERE id = 'b0000000-0000-4000-8000-000000000001';
  ASSERT n = 0, 'TEST 2a FAILED: a pending invitee can see the habit';
  RAISE NOTICE 'TEST 2a PASSED: pending invitee cannot see the habit';

  SELECT count(*) INTO n FROM public.completions WHERE id = 'c0000000-0000-4000-8000-000000000001';
  ASSERT n = 0, 'TEST 2b FAILED: a pending invitee can see completions';
  RAISE NOTICE 'TEST 2b PASSED: pending invitee cannot see completions';

  SELECT count(*) INTO n FROM storage.objects
   WHERE name = 'a1000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/private.jpg';
  ASSERT n = 0, 'TEST 2c FAILED: a pending invitee can see evidence media';
  RAISE NOTICE 'TEST 2c PASSED: pending invitee cannot see evidence media';

  -- but they must be able to read the invitation itself, or they could never answer it
  SELECT count(*) INTO n FROM public.habit_shares WHERE shared_with = auth.uid() AND status = 'pending';
  ASSERT n = 1, 'TEST 2d FAILED: a pending invitee cannot see their own invitation';
  RAISE NOTICE 'TEST 2d PASSED: pending invitee can read their own invitation';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: direct writes to habit_shares are revoked
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  INSERT INTO public.habit_shares (habit_id, shared_with, status, initiated_by)
  VALUES ('b0000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 'accepted', 'a2000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'TEST 3a FAILED: a client could INSERT its own accepted share';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'TEST 3a PASSED: direct INSERT on habit_shares is refused';
END $$;

DO $$
BEGIN
  UPDATE public.habit_shares SET status = 'accepted' WHERE shared_with = auth.uid();
  RAISE EXCEPTION 'TEST 3b FAILED: a client could UPDATE itself to accepted';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'TEST 3b PASSED: direct UPDATE on habit_shares is refused';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: accepting opens exactly the three doors
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_share UUID; n INT;
BEGIN
  SELECT id INTO v_share FROM public.habit_shares
   WHERE habit_id = 'b0000000-0000-4000-8000-000000000001' AND shared_with = auth.uid();

  PERFORM public.respond_habit_partner(v_share, true);

  SELECT count(*) INTO n FROM public.habits WHERE id = 'b0000000-0000-4000-8000-000000000001';
  ASSERT n = 1, 'TEST 4a FAILED: an accepted partner cannot see the habit';
  RAISE NOTICE 'TEST 4a PASSED: accepted partner sees the habit';

  SELECT count(*) INTO n FROM public.completions WHERE id = 'c0000000-0000-4000-8000-000000000001';
  ASSERT n = 1, 'TEST 4b FAILED: an accepted partner cannot see completions';
  RAISE NOTICE 'TEST 4b PASSED: accepted partner sees completions';

  SELECT count(*) INTO n FROM storage.objects
   WHERE name = 'a1000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000001/private.jpg';
  ASSERT n = 1, 'TEST 4c FAILED: an accepted partner cannot see evidence media';
  RAISE NOTICE 'TEST 4c PASSED: accepted partner sees evidence media';
END $$;

-- A private habit stays invisible to a friend who is not a partner.
SET LOCAL request.jwt.claims TO '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.habits WHERE id = 'b0000000-0000-4000-8000-000000000001';
  ASSERT n = 0, 'TEST 4d FAILED: a non-partner friend can see a private habit';
  RAISE NOTICE 'TEST 4d PASSED: private habit stays invisible to a non-partner friend';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: `public` does not leak the numbers
-- ---------------------------------------------------------------------------
-- Still carol: a friend, no partnership on either habit.

DO $$
DECLARE n INT; v_streak INT; v_vis TEXT;
BEGIN
  -- The public habit's completions are not hers to read…
  SELECT count(*) INTO n FROM public.completions WHERE id = 'c0000000-0000-4000-8000-000000000002';
  ASSERT n = 0, 'TEST 5a FAILED: a non-partner friend can read a public habit''s completions';
  RAISE NOTICE 'TEST 5a PASSED: public habit completions need a partnership';

  SELECT count(*) INTO n FROM storage.objects
   WHERE name = 'a1000000-0000-4000-8000-000000000001/b0000000-0000-4000-8000-000000000002/public.jpg';
  ASSERT n = 0, 'TEST 5b FAILED: a non-partner friend can read a public habit''s evidence';
  RAISE NOTICE 'TEST 5b PASSED: public habit evidence needs a partnership';

  -- …but she can find that it exists, with no streak attached.
  SELECT count(*) INTO n FROM public.get_profile_habits('a1000000-0000-4000-8000-000000000001');
  ASSERT n = 1, 'TEST 5c FAILED: discovery should list exactly the one public habit, got %', n;
  RAISE NOTICE 'TEST 5c PASSED: discovery lists the public habit and only that';

  SELECT streak_current, visibility::TEXT INTO v_streak, v_vis
    FROM public.get_profile_habits('a1000000-0000-4000-8000-000000000001');
  ASSERT v_vis = 'public', 'TEST 5d FAILED: wrong habit surfaced by discovery';
  ASSERT v_streak IS NULL, 'TEST 5d FAILED: discovery leaked the streak to a non-partner';
  RAISE NOTICE 'TEST 5d PASSED: discovery withholds the streak until partnership';
END $$;

-- Dave is not a friend at all: no discovery, no habit.
SET LOCAL request.jwt.claims TO '{"sub":"a4000000-0000-4000-8000-000000000004","role":"authenticated"}';

DO $$
BEGIN
  PERFORM public.get_profile_habits('a1000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'TEST 5e FAILED: a stranger could list someone''s habits';
EXCEPTION WHEN sqlstate 'P0004' THEN
  RAISE NOTICE 'TEST 5e PASSED: discovery refuses a non-friend';
END $$;

DO $$
BEGIN
  PERFORM public.request_habit_partner('b0000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'TEST 5f FAILED: a stranger could request partnership';
EXCEPTION WHEN sqlstate 'P0002' THEN
  RAISE NOTICE 'TEST 5f PASSED: a non-friend cannot request partnership';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a private habit cannot be requested, and does not admit it exists
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
BEGIN
  PERFORM public.request_habit_partner('b0000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'TEST 6a FAILED: a private habit accepted a partnership request';
EXCEPTION WHEN sqlstate 'P0002' THEN
  -- P0002 is also what a genuinely missing habit returns, which is the point:
  -- guessing an id must not distinguish "private" from "does not exist".
  RAISE NOTICE 'TEST 6a PASSED: a private habit refuses requests indistinguishably from a missing one';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: only the side that did not start it may answer
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_share UUID;
BEGIN
  -- Carol asks to join the public habit…
  SELECT id INTO v_share FROM public.request_habit_partner('b0000000-0000-4000-8000-000000000002');
  ASSERT v_share IS NOT NULL, 'TEST 7a FAILED: a friend could not request a public habit';
  RAISE NOTICE 'TEST 7a PASSED: a friend can request partnership on a public habit';

  -- …and cannot wave her own request through.
  BEGIN
    PERFORM public.respond_habit_partner(v_share, true);
    RAISE EXCEPTION 'TEST 7b FAILED: the requester could accept their own request';
  EXCEPTION WHEN sqlstate 'P0004' THEN
    RAISE NOTICE 'TEST 7b PASSED: the requester cannot accept their own request';
  END;
END $$;

-- Alice cannot accept an invitation she sent, either.
SET LOCAL request.jwt.claims TO '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_share UUID;
BEGIN
  SELECT id INTO v_share FROM public.invite_habit_partner(
    'b0000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002');

  BEGIN
    PERFORM public.respond_habit_partner(v_share, true);
    RAISE EXCEPTION 'TEST 7c FAILED: the owner could accept their own invitation';
  EXCEPTION WHEN sqlstate 'P0004' THEN
    RAISE NOTICE 'TEST 7c PASSED: the owner cannot accept their own invitation';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Test 8: the inbox sorts the two directions
-- ---------------------------------------------------------------------------
-- Still alice. Pending right now: carol's REQUEST on the public habit (hers to
-- answer) and her own INVITE to bob (his to answer, so not hers).

DO $$
DECLARE n INT; v_dir TEXT; v_person UUID;
BEGIN
  SELECT count(*) INTO n FROM public.get_partner_inbox();
  ASSERT n = 1, 'TEST 8a FAILED: alice''s inbox should hold one item, got %', n;

  SELECT direction, person_id INTO v_dir, v_person FROM public.get_partner_inbox();
  ASSERT v_dir = 'request', 'TEST 8a FAILED: expected a request, got %', v_dir;
  ASSERT v_person = 'a3000000-0000-4000-8000-000000000003', 'TEST 8a FAILED: wrong requester';
  RAISE NOTICE 'TEST 8a PASSED: the owner sees the request and not her own invitation';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE n INT; v_dir TEXT;
BEGIN
  SELECT count(*) INTO n FROM public.get_partner_inbox();
  ASSERT n = 1, 'TEST 8b FAILED: bob''s inbox should hold one item, got %', n;

  SELECT direction INTO v_dir FROM public.get_partner_inbox();
  ASSERT v_dir = 'invite', 'TEST 8b FAILED: expected an invite, got %', v_dir;
  RAISE NOTICE 'TEST 8b PASSED: the invitee sees the invitation';
END $$;

-- ---------------------------------------------------------------------------
-- Test 9: "no" is a real answer
-- ---------------------------------------------------------------------------

SET LOCAL request.jwt.claims TO '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_share UUID;
BEGIN
  SELECT id INTO v_share FROM public.habit_shares
   WHERE habit_id = 'b0000000-0000-4000-8000-000000000002'
     AND shared_with = 'a3000000-0000-4000-8000-000000000003';
  PERFORM public.respond_habit_partner(v_share, false);
  RAISE NOTICE 'TEST 9a PASSED: the owner can decline a request';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}';

DO $$
DECLARE n INT;
BEGIN
  -- A declined partner is a stranger to the habit again.
  SELECT count(*) INTO n FROM public.completions WHERE id = 'c0000000-0000-4000-8000-000000000002';
  ASSERT n = 0, 'TEST 9b FAILED: a declined requester can read completions';
  RAISE NOTICE 'TEST 9b PASSED: declining grants nothing';

  BEGIN
    PERFORM public.request_habit_partner('b0000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'TEST 9c FAILED: a declined requester could immediately ask again';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    RAISE NOTICE 'TEST 9c PASSED: re-asking is rate-limited after a decline';
  END;
END $$;

-- The owner, being the one who said no, can change her mind at any time.
SET LOCAL request.jwt.claims TO '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$
DECLARE v_status habit_partner_status;
BEGIN
  SELECT status INTO v_status FROM public.invite_habit_partner(
    'b0000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003');
  ASSERT v_status = 'pending', 'TEST 9d FAILED: re-inviting after a decline did not reopen the row';
  RAISE NOTICE 'TEST 9d PASSED: the owner can re-invite someone she declined';
END $$;

-- ---------------------------------------------------------------------------
-- Test 10: an accepted partnership survives re-invitation, and can be left
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_status habit_partner_status;
BEGIN
  -- Bob is an accepted partner on the private habit (test 4). Re-inviting must
  -- not knock him back to pending and quietly cut his access.
  SELECT status INTO v_status FROM public.invite_habit_partner(
    'b0000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002');
  ASSERT v_status = 'accepted', 'TEST 10a FAILED: re-inviting an accepted partner reset them to %', v_status;
  RAISE NOTICE 'TEST 10a PASSED: re-inviting an accepted partner is a no-op';
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"a4000000-0000-4000-8000-000000000004","role":"authenticated"}';

DO $$
BEGIN
  -- The id is named outright rather than looked up: dave cannot see this row,
  -- so a lookup would hand cancel_habit_partner a NULL and it would no-op,
  -- passing the test without ever reaching the guard being tested.
  BEGIN
    PERFORM public.cancel_habit_partner('d0000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'TEST 10b FAILED: a third party could cancel someone else''s partnership';
  EXCEPTION WHEN sqlstate 'P0004' THEN
    RAISE NOTICE 'TEST 10b PASSED: a third party cannot cancel a partnership';
  END;
END $$;

SET LOCAL request.jwt.claims TO '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}';

DO $$
DECLARE v_share UUID; n INT;
BEGIN
  SELECT id INTO v_share FROM public.habit_shares
   WHERE habit_id = 'b0000000-0000-4000-8000-000000000001' AND shared_with = auth.uid();
  ASSERT v_share IS NOT NULL, 'TEST 10c FAILED: a partner cannot see their own share row';
  PERFORM public.cancel_habit_partner(v_share);

  SELECT count(*) INTO n FROM public.habits WHERE id = 'b0000000-0000-4000-8000-000000000001';
  ASSERT n = 0, 'TEST 10c FAILED: a partner who left can still see the habit';
  RAISE NOTICE 'TEST 10c PASSED: a partner can leave, and loses access when they do';
END $$;

-- ---------------------------------------------------------------------------

DO $$ BEGIN RAISE NOTICE '=== ALL HABIT VISIBILITY TESTS PASSED ==='; END $$;

ROLLBACK;
