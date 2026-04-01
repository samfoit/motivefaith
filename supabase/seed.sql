-- ============================================================
-- Motive Comprehensive Seed Data
-- ============================================================
--
-- SAFETY: Abort if this appears to be a production database.
-- Seed data uses weak passwords and should NEVER run outside
-- local development (npx supabase db reset).
DO $$
BEGIN
  -- In local Supabase, the API URL contains 127.0.0.1 or localhost.
  -- Production databases will have a different hostname.
  IF current_setting('app.settings.supabase_url', true) IS NOT NULL
     AND current_setting('app.settings.supabase_url', true) NOT LIKE '%127.0.0.1%'
     AND current_setting('app.settings.supabase_url', true) NOT LIKE '%localhost%'
  THEN
    RAISE EXCEPTION 'SEED ABORTED: refusing to seed a non-local database (%).',
      current_setting('app.settings.supabase_url', true);
  END IF;
END
$$;
--
-- Use local timezone for date math so seed data aligns with
-- the JS app (which uses the server machine's timezone).
-- Postgres in Docker uses UTC; this ensures CURRENT_DATE offsets
-- produce timestamps that look correct from the app's perspective.
SET timezone = 'America/Chicago';
--
-- TEST ACCOUNTS (all passwords: password123)
-- ┌──────────┬──────────────────┬────────────────────────────────┐
-- │ Email    │ Username         │ Role                           │
-- ├──────────┼──────────────────┼────────────────────────────────┤
-- │ alice@test.com │ alice_j    │ Power user, 4 habits, streaks  │
-- │ bob@test.com   │ bob_smith  │ Active user, 14-day streak     │
-- │ charlie@test.com│ charlie_b │ New user, 1 habit, 1 day       │
-- │ diana@test.com │ diana_r    │ Returning, paused habits       │
-- │ eve@test.com   │ eve_w      │ Social user, encouragements    │
-- │ frank@test.com │ frank_m    │ Minimal user, 0 completions    │
-- └──────────┴──────────────────┴────────────────────────────────┘
--
-- Run: npx supabase db reset
-- ============================================================


-- =============================================
-- 1. AUTH USERS
-- =============================================
-- The on_auth_user_created trigger auto-creates profiles
-- with display_name and username from raw_user_meta_data.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) VALUES
  -- Alice Johnson: Power user
  (
    '00000000-0000-0000-0000-000000000000',
    'a1111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'alice@test.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Alice Johnson","username":"alice_j"}',
    now() - interval '90 days', now(), '', '',
    '', '', '', '', '', ''
  ),
  -- Bob Smith: Active user
  (
    '00000000-0000-0000-0000-000000000000',
    'b2222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated',
    'bob@test.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Bob Smith","username":"bob_smith"}',
    now() - interval '60 days', now(), '', '',
    '', '', '', '', '', ''
  ),
  -- Charlie Brown: New user
  (
    '00000000-0000-0000-0000-000000000000',
    'c3333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated',
    'charlie@test.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Charlie Brown","username":"charlie_b"}',
    now() - interval '7 days', now(), '', '',
    '', '', '', '', '', ''
  ),
  -- Diana Ross: Returning user with paused habits
  (
    '00000000-0000-0000-0000-000000000000',
    'd4444444-4444-4444-4444-444444444444',
    'authenticated', 'authenticated',
    'diana@test.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Diana Ross","username":"diana_r"}',
    now() - interval '45 days', now(), '', '',
    '', '', '', '', '', ''
  ),
  -- Eve Wilson: Social user
  (
    '00000000-0000-0000-0000-000000000000',
    'e5555555-5555-5555-5555-555555555555',
    'authenticated', 'authenticated',
    'eve@test.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Eve Wilson","username":"eve_w"}',
    now() - interval '30 days', now(), '', '',
    '', '', '', '', '', ''
  ),
  -- Frank Miller: Minimal user
  (
    '00000000-0000-0000-0000-000000000000',
    'f6666666-6666-6666-6666-666666666666',
    'authenticated', 'authenticated',
    'frank@test.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Frank Miller","username":"frank_m"}',
    now() - interval '3 days', now(), '', '',
    '', '', '', '', '', ''
  );

-- Auth identities (required for email/password login)
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
   jsonb_build_object('sub', 'a1111111-1111-1111-1111-111111111111', 'email', 'alice@test.com'),
   'email', 'a1111111-1111-1111-1111-111111111111', now(), now() - interval '90 days', now()),
  ('b2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222',
   jsonb_build_object('sub', 'b2222222-2222-2222-2222-222222222222', 'email', 'bob@test.com'),
   'email', 'b2222222-2222-2222-2222-222222222222', now(), now() - interval '60 days', now()),
  ('c3333333-3333-3333-3333-333333333333', 'c3333333-3333-3333-3333-333333333333',
   jsonb_build_object('sub', 'c3333333-3333-3333-3333-333333333333', 'email', 'charlie@test.com'),
   'email', 'c3333333-3333-3333-3333-333333333333', now(), now() - interval '7 days', now()),
  ('d4444444-4444-4444-4444-444444444444', 'd4444444-4444-4444-4444-444444444444',
   jsonb_build_object('sub', 'd4444444-4444-4444-4444-444444444444', 'email', 'diana@test.com'),
   'email', 'd4444444-4444-4444-4444-444444444444', now(), now() - interval '45 days', now()),
  ('e5555555-5555-5555-5555-555555555555', 'e5555555-5555-5555-5555-555555555555',
   jsonb_build_object('sub', 'e5555555-5555-5555-5555-555555555555', 'email', 'eve@test.com'),
   'email', 'e5555555-5555-5555-5555-555555555555', now(), now() - interval '30 days', now()),
  ('f6666666-6666-6666-6666-666666666666', 'f6666666-6666-6666-6666-666666666666',
   jsonb_build_object('sub', 'f6666666-6666-6666-6666-666666666666', 'email', 'frank@test.com'),
   'email', 'f6666666-6666-6666-6666-666666666666', now(), now() - interval '3 days', now());


-- =============================================
-- 2. PROFILE UPDATES
-- =============================================
-- Trigger created basic profiles; now enrich with optional fields.

-- Alice: avatar, push subscription, custom quiet hours, EST timezone
UPDATE profiles SET
  avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice',
  date_of_birth = '1995-06-15',
  push_subscription = '{"endpoint":"https://fcm.googleapis.com/fcm/send/alice-token","keys":{"p256dh":"BNcRdreALRFXTkOhi8…","auth":"tBHItJI5…"}}',
  notification_prefs = '{"quiet_start":"23:00","quiet_end":"06:00","completion_alerts":true,"miss_alerts":true}',
  timezone = 'America/New_York'
WHERE id = 'a1111111-1111-1111-1111-111111111111';

-- Bob: avatar, PST timezone (no push subscription)
UPDATE profiles SET
  avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob',
  date_of_birth = '1998-03-22',
  timezone = 'America/Los_Angeles'
WHERE id = 'b2222222-2222-2222-2222-222222222222';

-- Charlie: new user — keep defaults (no avatar, UTC, default notif prefs)

-- Diana: avatar, custom notif prefs (miss alerts off), CET timezone
UPDATE profiles SET
  avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=diana',
  date_of_birth = '1992-11-08',
  notification_prefs = '{"quiet_start":"21:00","quiet_end":"08:00","completion_alerts":true,"miss_alerts":false}',
  timezone = 'Europe/Berlin'
WHERE id = 'd4444444-4444-4444-4444-444444444444';

-- Eve: avatar, push subscription, late-night quiet hours, CST timezone
UPDATE profiles SET
  avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=eve',
  date_of_birth = '2000-01-30',
  push_subscription = '{"endpoint":"https://fcm.googleapis.com/fcm/send/eve-token","keys":{"p256dh":"BPmR3drc…","auth":"xK2p…"}}',
  notification_prefs = '{"quiet_start":"00:00","quiet_end":"06:00","completion_alerts":true,"miss_alerts":true}',
  timezone = 'America/Chicago'
WHERE id = 'e5555555-5555-5555-5555-555555555555';

-- Frank: minimal — keep all defaults


-- =============================================
-- 3. HABITS (14 total)
-- =============================================
-- Covers: all 5 frequencies, 7 categories, shared/private,
--   paused/active, with/without time_window, with/without description

INSERT INTO habits (
  id, user_id, title, description, emoji, color,
  frequency, schedule, time_window, category,
  is_shared, is_paused, created_at
) VALUES
  -- ── ALICE (4 habits) ──
  ('00000000-0000-0000-0000-000000000101', 'a1111111-1111-1111-1111-111111111111',
   'Morning Run', '5K run before work to start the day with energy',
   '🏃', '#ef4444', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   '{"start":"06:00","end":"10:00"}', 'fitness', true, false,
   now() - interval '30 days'),

  ('00000000-0000-0000-0000-000000000102', 'a1111111-1111-1111-1111-111111111111',
   'Meditation', '10-20 minute mindfulness session',
   '🧘', '#8b5cf6', 'weeksdays', '{"days":[1,2,3,4,5]}',
   '{"start":"07:00","end":"09:00"}', 'mindfulness', true, false,
   now() - interval '30 days'),

  ('00000000-0000-0000-0000-000000000103', 'a1111111-1111-1111-1111-111111111111',
   'Read a Book', 'Read at least 30 pages on weekends',
   '📚', '#3b82f6', 'weekends', '{"days":[0,6]}',
   NULL, 'learning', false, false,
   now() - interval '30 days'),

  ('00000000-0000-0000-0000-000000000104', 'a1111111-1111-1111-1111-111111111111',
   'Sketch', NULL,
   '✏️', '#ec4899', 'specific_days', '{"days":[1,3,5]}',
   NULL, 'creative', false, false,
   now() - interval '20 days'),

  -- ── BOB (3 habits) ──
  ('00000000-0000-0000-0000-000000000201', 'b2222222-2222-2222-2222-222222222222',
   'Drink Water', 'Drink 8 glasses throughout the day',
   '💧', '#22c55e', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'health', true, false,
   now() - interval '30 days'),

  ('00000000-0000-0000-0000-000000000202', 'b2222222-2222-2222-2222-222222222222',
   'Call Family', 'Weekly call with parents',
   '📞', '#f59e0b', 'weekly', '{"days":[0]}',
   NULL, 'social', false, false,
   now() - interval '30 days'),

  ('00000000-0000-0000-0000-000000000203', 'b2222222-2222-2222-2222-222222222222',
   'Study Spanish', 'Duolingo or flashcards for 15 min',
   '🇪🇸', '#3b82f6', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'learning', false, true,  -- PAUSED
   now() - interval '45 days'),

  -- ── CHARLIE (1 habit) ──
  ('00000000-0000-0000-0000-000000000301', 'c3333333-3333-3333-3333-333333333333',
   'Push-ups', 'Do 3 sets of 10 push-ups',
   '💪', '#ef4444', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'fitness', false, false,
   now() - interval '1 day'),

  -- ── DIANA (2 habits) ──
  ('00000000-0000-0000-0000-000000000401', 'd4444444-4444-4444-4444-444444444444',
   'Deep Breathing', '5 minutes of box breathing',
   '🌬️', '#8b5cf6', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'mindfulness', false, true,  -- PAUSED
   now() - interval '45 days'),

  ('00000000-0000-0000-0000-000000000402', 'd4444444-4444-4444-4444-444444444444',
   'Vitamins', 'Take daily vitamins and supplements',
   '💊', '#22c55e', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   '{"start":"08:00","end":"12:00"}', 'health', true, false,
   now() - interval '30 days'),

  -- ── EVE (3 habits) ──
  ('00000000-0000-0000-0000-000000000501', 'e5555555-5555-5555-5555-555555555555',
   'Coffee Chat', 'Have a meaningful conversation today',
   '☕', '#f59e0b', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'social', true, false,
   now() - interval '15 days'),

  ('00000000-0000-0000-0000-000000000502', 'e5555555-5555-5555-5555-555555555555',
   'Yoga', '30-minute yoga flow',
   '🧘‍♀️', '#ef4444', 'weeksdays', '{"days":[1,2,3,4,5]}',
   '{"start":"06:00","end":"08:00"}', 'fitness', true, false,
   now() - interval '15 days'),

  ('00000000-0000-0000-0000-000000000503', 'e5555555-5555-5555-5555-555555555555',
   'Paint', NULL,
   '🎨', '#ec4899', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'creative', false, false,
   now() - interval '20 days'),

  -- ── FRANK (1 habit) ──
  ('00000000-0000-0000-0000-000000000601', 'f6666666-6666-6666-6666-666666666666',
   'Walk', NULL,
   '🚶', '#6366F1', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'general', false, false,
   now() - interval '2 days'),

  -- ── Challenge habits (created when joining "7-Day Early Bird") ──
  ('00000000-0000-0000-0000-0000000c0101', 'a1111111-1111-1111-1111-111111111111',
   '7-Day Early Bird', 'Wake up before 7 AM and do something productive for 7 consecutive days.',
   '🌅', '#f59e0b', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'health', false, false,
   now() - interval '3 days'),

  ('00000000-0000-0000-0000-0000000c0201', 'b2222222-2222-2222-2222-222222222222',
   '7-Day Early Bird', 'Wake up before 7 AM and do something productive for 7 consecutive days.',
   '🌅', '#f59e0b', 'daily', '{"days":[0,1,2,3,4,5,6]}',
   NULL, 'health', false, false,
   now() - interval '2 days');


-- =============================================
-- 4. COMPLETIONS
-- =============================================
-- Disable streak trigger so we can bulk-insert and set streaks manually.
ALTER TABLE completions DISABLE TRIGGER on_completion_insert;

-- ── Alice: Morning Run ──
-- 6 consecutive days (not completed today) → streak=6, best=6
-- Completing today will trigger the 7-day milestone celebration
-- Types: photo (with evidence), quick (bare)
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101',
   'photo', 'https://example.com/completions/alice/run1.jpg', 'Sunrise run!',
   CURRENT_DATE - 6 + time '07:15'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101',
   'quick', NULL, NULL,
   CURRENT_DATE - 5 + time '06:45'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101',
   'photo', 'https://example.com/completions/alice/run2.jpg', NULL,
   CURRENT_DATE - 4 + time '07:30'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101',
   'quick', NULL, 'Easy 5K today',
   CURRENT_DATE - 3 + time '08:00'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101',
   'photo', 'https://example.com/completions/alice/run3.jpg', 'New personal best!',
   CURRENT_DATE - 2 + time '06:50'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101',
   'quick', NULL, NULL,
   CURRENT_DATE - 1 + time '07:20');

-- ── Alice: Meditation ──
-- Broken + rebuilt: days -14,-13,-12 (streak 3), gap, -9,-8 (streak 2), gap, -1,today (streak 2)
-- Final: streak=2, best=3
-- Types: message (with notes), quick
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'message', NULL, '10 minutes of breathing exercises',
   CURRENT_DATE - 14 + time '07:30'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'message', NULL, 'Guided meditation on Headspace',
   CURRENT_DATE - 13 + time '07:45'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'message', NULL, 'Body scan meditation',
   CURRENT_DATE - 12 + time '08:00'),
  -- GAP: days -11 through -10 missed
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'quick', NULL, NULL,
   CURRENT_DATE - 9 + time '07:15'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'message', NULL, 'Loving-kindness meditation',
   CURRENT_DATE - 8 + time '08:10'),
  -- GAP: days -7 through -2 missed
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'quick', NULL, NULL,
   CURRENT_DATE - 1 + time '07:30'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000102',
   'message', NULL, '20-minute deep focus session!',
   CURRENT_DATE + time '07:45');

-- ── Alice: Read a Book ──
-- Weekend reading, 7-day gaps between completions → streak always resets
-- Final: streak=1, best=1
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000103',
   'message', NULL, 'Chapter 3 of Atomic Habits',
   CURRENT_DATE - 21 + time '10:00'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000103',
   'message', NULL, 'Finished Atomic Habits!',
   CURRENT_DATE - 14 + time '14:30'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000103',
   'photo', 'https://example.com/completions/alice/book1.jpg', 'Started Deep Work',
   CURRENT_DATE - 7 + time '11:00'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000103',
   'message', NULL, 'Great chapter on focus',
   CURRENT_DATE - 1 + time '15:00');

-- ── Alice: Sketch ──
-- Days -12,-11 consecutive (streak 2), gap, -5 (reset), gap, -3 (reset)
-- Final: streak=1, best=2
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000104',
   'photo', 'https://example.com/completions/alice/sketch1.jpg', 'Landscape sketch',
   CURRENT_DATE - 12 + time '19:00'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000104',
   'photo', 'https://example.com/completions/alice/sketch2.jpg', 'Portrait practice',
   CURRENT_DATE - 11 + time '20:30'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000104',
   'quick', NULL, NULL,
   CURRENT_DATE - 5 + time '18:00'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000104',
   'photo', 'https://example.com/completions/alice/sketch3.jpg', 'Still life drawing',
   CURRENT_DATE - 3 + time '19:30');

-- ── Bob: Drink Water ──
-- 14 consecutive days → streak=14, best=14 (milestone!)
-- Mostly quick with occasional notes
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 13 + time '08:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 12 + time '09:30'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, 'New water bottle!', CURRENT_DATE - 11 + time '07:45'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 10 + time '10:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 9 + time '08:15'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 8 + time '11:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, 'One week streak!', CURRENT_DATE - 7 + time '08:30'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 6 + time '09:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 5 + time '07:50'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'message', NULL, 'Staying hydrated at the gym', CURRENT_DATE - 4 + time '14:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 3 + time '08:45'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, NULL, CURRENT_DATE - 2 + time '10:15'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, 'Almost 2 weeks!', CURRENT_DATE - 1 + time '08:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000201',
   'quick', NULL, 'Two week streak! 🎉', CURRENT_DATE + time '09:00');

-- ── Bob: Call Family ──
-- Weekly, 7-day gaps → streak always 1
-- Final: streak=1, best=1
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000202',
   'message', NULL, 'Caught up with mom and dad',
   CURRENT_DATE - 21 + time '17:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000202',
   'message', NULL, 'Video called the family',
   CURRENT_DATE - 14 + time '18:30'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000202',
   'quick', NULL, NULL,
   CURRENT_DATE - 7 + time '16:00');

-- ── Bob: Study Spanish (PAUSED) ──
-- 5 consecutive days then paused → streak=5, best=5
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000203',
   'message', NULL, 'Learned 20 new words',
   CURRENT_DATE - 30 + time '20:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000203',
   'quick', NULL, NULL,
   CURRENT_DATE - 29 + time '21:00'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000203',
   'message', NULL, 'Practiced past tense verbs',
   CURRENT_DATE - 28 + time '19:30'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000203',
   'message', NULL, 'Duolingo streak 15!',
   CURRENT_DATE - 27 + time '20:15'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000203',
   'quick', NULL, NULL,
   CURRENT_DATE - 26 + time '22:00');

-- ── Charlie: Push-ups ──
-- Brand new, 1 completion today → streak=1, best=1
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000301',
   'quick', NULL, NULL,
   CURRENT_DATE + time '08:30');

-- ── Diana: Deep Breathing (PAUSED) ──
-- 3 consecutive days long ago, then paused → streak=3, best=3
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000401',
   'message', NULL, 'Box breathing 4-4-4-4',
   CURRENT_DATE - 40 + time '09:00'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000401',
   'message', NULL, '4-7-8 breathing technique',
   CURRENT_DATE - 39 + time '08:45'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000401',
   'quick', NULL, NULL,
   CURRENT_DATE - 38 + time '09:15');

-- ── Diana: Vitamins ──
-- 5 consecutive days (-20 to -16), gap, then -5 → streak broken
-- Final: streak=1, best=5
-- NOTE: shared + daily + time_window + no today completion → tests missed habit detection
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000402',
   'quick', NULL, NULL, CURRENT_DATE - 20 + time '08:30'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000402',
   'quick', NULL, NULL, CURRENT_DATE - 19 + time '09:00'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000402',
   'quick', NULL, NULL, CURRENT_DATE - 18 + time '08:15'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000402',
   'quick', NULL, NULL, CURRENT_DATE - 17 + time '10:00'),
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000402',
   'quick', NULL, NULL, CURRENT_DATE - 16 + time '08:45'),
  -- GAP: days -15 through -6 missed (streak breaks)
  ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000402',
   'quick', NULL, NULL, CURRENT_DATE - 5 + time '11:00');

-- ── Eve: Coffee Chat ──
-- 10 consecutive days → streak=10, best=10 (milestone!)
-- Types: message, quick, photo, video (all 4 types represented)
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'message', NULL, 'Great chat with a colleague',
   CURRENT_DATE - 9 + time '10:30'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'quick', NULL, NULL,
   CURRENT_DATE - 8 + time '11:00'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'photo', 'https://example.com/completions/eve/coffee1.jpg', 'Coffee with Sarah!',
   CURRENT_DATE - 7 + time '09:45'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'message', NULL, 'Deep conversation about career goals',
   CURRENT_DATE - 6 + time '14:00'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'video', 'https://example.com/completions/eve/chat1.mp4', 'Funny moment at lunch',
   CURRENT_DATE - 5 + time '12:30'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'quick', NULL, NULL,
   CURRENT_DATE - 4 + time '10:15'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'message', NULL, 'Coffee date with a new friend',
   CURRENT_DATE - 3 + time '16:00'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'video', 'https://example.com/completions/eve/chat2.mp4', NULL,
   CURRENT_DATE - 2 + time '11:45'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'photo', 'https://example.com/completions/eve/coffee2.jpg', 'Rainy day cafe visit',
   CURRENT_DATE - 1 + time '10:00'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000501',
   'message', NULL, 'Morning check-in with roommate',
   CURRENT_DATE + time '08:30');

-- ── Eve: Yoga ──
-- Days -11,-10 consecutive (streak 2), gap, -4,-3,-2 consecutive (streak 3)
-- Final: streak=3, best=3
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000502',
   'photo', 'https://example.com/completions/eve/yoga1.jpg', 'Sunrise flow',
   CURRENT_DATE - 11 + time '06:30'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000502',
   'photo', 'https://example.com/completions/eve/yoga2.jpg', NULL,
   CURRENT_DATE - 10 + time '06:45'),
  -- GAP
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000502',
   'quick', NULL, NULL,
   CURRENT_DATE - 4 + time '07:00'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000502',
   'photo', 'https://example.com/completions/eve/yoga3.jpg', 'New yoga mat!',
   CURRENT_DATE - 3 + time '06:15'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000502',
   'quick', NULL, NULL,
   CURRENT_DATE - 2 + time '07:30');

-- ── Eve: Paint ──
-- Scattered: -15, -8, -3 (no consecutive) → streak=1, best=1
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000503',
   'photo', 'https://example.com/completions/eve/paint1.jpg', 'Watercolor landscape',
   CURRENT_DATE - 15 + time '19:00'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000503',
   'photo', 'https://example.com/completions/eve/paint2.jpg', 'Abstract acrylic piece',
   CURRENT_DATE - 8 + time '20:30'),
  ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000503',
   'photo', 'https://example.com/completions/eve/paint3.jpg', NULL,
   CURRENT_DATE - 3 + time '18:45');

-- ── Frank: Walk ── NO completions (tests zero-state)

-- ── Alice: 7-Day Early Bird (challenge) ──
-- 3 consecutive days → streak=3, best=3
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000c0101',
   'photo', 'https://example.com/completions/alice/earlybird1.jpg', 'Up at 6:30!',
   CURRENT_DATE - 2 + time '06:45'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000c0101',
   'quick', NULL, NULL,
   CURRENT_DATE - 1 + time '06:30'),
  ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000c0101',
   'photo', 'https://example.com/completions/alice/earlybird3.jpg', 'Sunrise yoga',
   CURRENT_DATE + time '06:15');

-- ── Bob: 7-Day Early Bird (challenge) ──
-- 2 consecutive days → streak=2, best=2
INSERT INTO completions (user_id, habit_id, completion_type, evidence_url, notes, completed_at) VALUES
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000c0201',
   'quick', NULL, 'Made it!',
   CURRENT_DATE - 1 + time '06:50'),
  ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000c0201',
   'photo', 'https://example.com/completions/bob/earlybird2.jpg', NULL,
   CURRENT_DATE + time '06:40');

-- =============================================
-- Set streak values manually (trigger was disabled)
-- =============================================
UPDATE habits SET streak_current = 6,  streak_best = 6,  total_completions = 6  WHERE id = '00000000-0000-0000-0000-000000000101';
UPDATE habits SET streak_current = 2,  streak_best = 3,  total_completions = 7  WHERE id = '00000000-0000-0000-0000-000000000102';
UPDATE habits SET streak_current = 1,  streak_best = 1,  total_completions = 4  WHERE id = '00000000-0000-0000-0000-000000000103';
UPDATE habits SET streak_current = 1,  streak_best = 2,  total_completions = 4  WHERE id = '00000000-0000-0000-0000-000000000104';
UPDATE habits SET streak_current = 14, streak_best = 14, total_completions = 14 WHERE id = '00000000-0000-0000-0000-000000000201';
UPDATE habits SET streak_current = 1,  streak_best = 1,  total_completions = 3  WHERE id = '00000000-0000-0000-0000-000000000202';
UPDATE habits SET streak_current = 5,  streak_best = 5,  total_completions = 5  WHERE id = '00000000-0000-0000-0000-000000000203';
UPDATE habits SET streak_current = 1,  streak_best = 1,  total_completions = 1  WHERE id = '00000000-0000-0000-0000-000000000301';
UPDATE habits SET streak_current = 3,  streak_best = 3,  total_completions = 3  WHERE id = '00000000-0000-0000-0000-000000000401';
UPDATE habits SET streak_current = 1,  streak_best = 5,  total_completions = 6  WHERE id = '00000000-0000-0000-0000-000000000402';
UPDATE habits SET streak_current = 10, streak_best = 10, total_completions = 10 WHERE id = '00000000-0000-0000-0000-000000000501';
UPDATE habits SET streak_current = 3,  streak_best = 3,  total_completions = 5  WHERE id = '00000000-0000-0000-0000-000000000502';
UPDATE habits SET streak_current = 1,  streak_best = 1,  total_completions = 3  WHERE id = '00000000-0000-0000-0000-000000000503';
-- Frank's Walk: stays at defaults (0, 0, 0)
UPDATE habits SET streak_current = 3,  streak_best = 3,  total_completions = 3  WHERE id = '00000000-0000-0000-0000-0000000c0101';
UPDATE habits SET streak_current = 2,  streak_best = 2,  total_completions = 2  WHERE id = '00000000-0000-0000-0000-0000000c0201';

-- Re-enable streak trigger for normal app operation
ALTER TABLE completions ENABLE TRIGGER on_completion_insert;


-- =============================================
-- 5. HABIT SHARES
-- =============================================
-- Covers: both notifications on, completion only, miss only, both off

INSERT INTO habit_shares (habit_id, shared_with, notify_complete, notify_miss) VALUES
  -- Alice's Morning Run → Bob (all notifications)
  ('00000000-0000-0000-0000-000000000101', 'b2222222-2222-2222-2222-222222222222', true, true),
  -- Alice's Morning Run → Eve (completion only)
  ('00000000-0000-0000-0000-000000000101', 'e5555555-5555-5555-5555-555555555555', true, false),
  -- Alice's Meditation → Bob (miss only)
  ('00000000-0000-0000-0000-000000000102', 'b2222222-2222-2222-2222-222222222222', false, true),
  -- Bob's Drink Water → Alice (all notifications)
  ('00000000-0000-0000-0000-000000000201', 'a1111111-1111-1111-1111-111111111111', true, true),
  -- Bob's Drink Water → Diana (both off)
  ('00000000-0000-0000-0000-000000000201', 'd4444444-4444-4444-4444-444444444444', false, false),
  -- Diana's Vitamins → Bob (all notifications)
  ('00000000-0000-0000-0000-000000000402', 'b2222222-2222-2222-2222-222222222222', true, true),
  -- Eve's Coffee Chat → Alice (all notifications)
  ('00000000-0000-0000-0000-000000000501', 'a1111111-1111-1111-1111-111111111111', true, true),
  -- Eve's Coffee Chat → Bob (completion only)
  ('00000000-0000-0000-0000-000000000501', 'b2222222-2222-2222-2222-222222222222', true, false),
  -- Eve's Yoga → Alice (miss only)
  ('00000000-0000-0000-0000-000000000502', 'a1111111-1111-1111-1111-111111111111', false, true);


-- =============================================
-- 6. FRIENDSHIPS
-- =============================================
-- Covers: accepted (5), pending (2), blocked (1)

INSERT INTO friendships (register_id, addressee_id, status, created_at) VALUES
  -- Accepted
  ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'accepted', now() - interval '55 days'),
  ('a1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'accepted', now() - interval '5 days'),
  ('a1111111-1111-1111-1111-111111111111', 'e5555555-5555-5555-5555-555555555555', 'accepted', now() - interval '25 days'),
  ('b2222222-2222-2222-2222-222222222222', 'd4444444-4444-4444-4444-444444444444', 'accepted', now() - interval '40 days'),
  ('b2222222-2222-2222-2222-222222222222', 'e5555555-5555-5555-5555-555555555555', 'accepted', now() - interval '20 days'),
  -- Pending
  ('c3333333-3333-3333-3333-333333333333', 'd4444444-4444-4444-4444-444444444444', 'pending', now() - interval '2 days'),
  ('e5555555-5555-5555-5555-555555555555', 'f6666666-6666-6666-6666-666666666666', 'pending', now() - interval '1 day'),
  -- Blocked
  ('d4444444-4444-4444-4444-444444444444', 'e5555555-5555-5555-5555-555555555555', 'blocked', now() - interval '10 days');


-- =============================================
-- 7. ENCOURAGEMENTS
-- =============================================
-- Covers: all 4 types (nudge/message/emoji/voice),
--   read/unread, with/without habit reference, with/without content

INSERT INTO encouragements (user_id, recipient_id, encouragement_type, content, is_read, created_at) VALUES
  -- nudge: no content, unread
  ('b2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111',
   'nudge', NULL, false,
   now() - interval '2 hours'),

  -- message: with content, read
  ('b2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111',
   'message', 'Keep it up! You''re on fire!', true,
   now() - interval '3 days'),

  -- emoji: with content, unread
  ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
   'emoji', '🔥💪🎯', false,
   now() - interval '1 day'),

  -- message: read
  ('e5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
   'message', 'Hey, let''s work out together tomorrow!', true,
   now() - interval '5 days'),

  -- nudge: no content, unread
  ('a1111111-1111-1111-1111-111111111111', 'e5555555-5555-5555-5555-555555555555',
   'nudge', NULL, false,
   now() - interval '6 hours'),

  -- emoji: simple, read
  ('d4444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222',
   'emoji', '👍', true,
   now() - interval '8 days'),

  -- message: unread
  ('b2222222-2222-2222-2222-222222222222', 'e5555555-5555-5555-5555-555555555555',
   'message', 'Miss our workout sessions!', false,
   now() - interval '12 hours'),

  -- voice: with URL content, unread
  ('e5555555-5555-5555-5555-555555555555', 'b2222222-2222-2222-2222-222222222222',
   'voice', 'https://example.com/voice/encouragement1.webm', false,
   now() - interval '4 hours'),

  -- message: welcome to new user, unread
  ('a1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333',
   'message', 'Welcome to Motive! Let''s keep each other accountable!', false,
   now() - interval '4 days'),

  -- emoji: running themed, read
  ('e5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
   'emoji', '🏃‍♀️💨', true,
   now() - interval '2 days');


-- =============================================
-- 8. GROUPS (Accountability Circles)
-- =============================================

-- "Morning Accountability Crew" — alice (admin), bob + charlie (members)
INSERT INTO groups (id, name, description, avatar_url, created_by, invite_code, settings, created_at)
VALUES (
  '01111111-1111-1111-1111-111111111111',
  'Morning Accountability Crew',
  'Early risers who hold each other accountable for morning routines.',
  NULL,
  'a1111111-1111-1111-1111-111111111111',
  'abc123def456',
  '{"allow_member_invites": true, "require_approval": false}',
  now() - interval '20 days'
);

INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES
  ('01111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'admin', now() - interval '20 days'),
  ('01111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'member', now() - interval '18 days'),
  ('01111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'member', now() - interval '5 days');

-- Share Alice's Morning Run and Bob's Drink Water to the group
INSERT INTO group_habit_shares (group_id, habit_id, shared_by, created_at) VALUES
  ('01111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000101', 'a1111111-1111-1111-1111-111111111111', now() - interval '18 days'),
  ('01111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000201', 'b2222222-2222-2222-2222-222222222222', now() - interval '15 days');

-- Group messages
INSERT INTO group_messages (group_id, user_id, content, created_at) VALUES
  ('01111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Welcome to the crew! Let''s crush our morning routines!', now() - interval '18 days'),
  ('01111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'Excited to be here! Day 1 of accountability starts now 💪', now() - interval '17 days');

-- Active challenge: "7-Day Early Bird Challenge"
INSERT INTO group_challenges (id, group_id, title, emoji, description, color, category, frequency, schedule, start_date, end_date, is_active, created_by, created_at)
VALUES (
  'ca111111-1111-1111-1111-111111111111',
  '01111111-1111-1111-1111-111111111111',
  '7-Day Early Bird',
  '🌅',
  'Wake up before 7 AM and do something productive for 7 consecutive days.',
  '#f59e0b',
  'health',
  'daily',
  '{"days": [0,1,2,3,4,5,6]}',
  CURRENT_DATE - 3,
  CURRENT_DATE + 4,
  true,
  'a1111111-1111-1111-1111-111111111111',
  now() - interval '3 days'
);

-- Challenge participants: alice + bob joined (habit_id points to their personal challenge habits)
INSERT INTO group_challenge_participants (challenge_id, user_id, habit_id, joined_at) VALUES
  ('ca111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000c0101', now() - interval '3 days'),
  ('ca111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000c0201', now() - interval '2 days');
