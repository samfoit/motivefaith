-- ============================================================
-- 001_schema.sql — Extensions, enums, tables, indexes
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgaudit SCHEMA extensions;

-- ── Enums ──

CREATE TYPE habit_frequency AS ENUM ('daily', 'weeksdays', 'weekends', 'specific_days', 'weekly');
CREATE TYPE completion_type AS ENUM ('photo', 'video', 'message', 'quick');
CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');
CREATE TYPE encouragement_type AS ENUM ('nudge', 'message', 'emoji', 'voice');
CREATE TYPE group_role AS ENUM ('admin', 'member');
CREATE TYPE report_reason AS ENUM (
  'illegal', 'csam', 'intimate_imagery', 'copyright',
  'harassment', 'spam', 'other'
);
CREATE TYPE report_status AS ENUM ('pending', 'reviewed', 'actioned', 'dismissed');

-- ── Helper function (must precede habits table CHECK constraint) ──

CREATE OR REPLACE FUNCTION public.is_valid_schedule(schedule jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  elem text;
BEGIN
  IF schedule IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(schedule->'days') != 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(schedule->'days') = 0 THEN RETURN false; END IF;
  FOR elem IN SELECT jsonb_array_elements_text(schedule->'days')
  LOOP
    IF elem::int NOT BETWEEN 0 AND 6 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- ── profiles ──

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  push_subscription JSONB,
  notification_prefs JSONB DEFAULT '{
    "quiet_start": "22:00",
    "quiet_end": "07:00",
    "completion_alerts": true,
    "miss_alerts": true
  }'::jsonb,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  date_of_birth DATE,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_display_name_length CHECK (char_length(display_name) <= 100),
  CONSTRAINT chk_username_format CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$')
);

-- ── habits ──

CREATE TABLE public.habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  emoji TEXT DEFAULT '✅',
  color TEXT DEFAULT '#6366F1',
  frequency habit_frequency NOT NULL DEFAULT 'daily',
  schedule JSONB DEFAULT '{"days": [1,2,3,4,5,6,0]}'::jsonb,
  time_window JSONB,
  category TEXT DEFAULT 'general',
  is_shared BOOLEAN DEFAULT false,
  streak_current INT DEFAULT 0,
  streak_best INT DEFAULT 0,
  total_completions INT DEFAULT 0,
  is_paused BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_schedule CHECK (is_valid_schedule(schedule)),
  CONSTRAINT valid_time_window CHECK (
    time_window IS NULL OR (
      jsonb_typeof(time_window) = 'object'
      AND (time_window->>'start') ~ '^\d{2}:\d{2}$'
      AND (time_window->>'end') ~ '^\d{2}:\d{2}$'
    )
  )
);

-- ── completions ──

CREATE TABLE public.completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  habit_id UUID REFERENCES public.habits(id) ON DELETE CASCADE NOT NULL,
  completion_type completion_type DEFAULT 'quick',
  evidence_url TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ DEFAULT now(),
  completed_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── habit_shares ──

CREATE TABLE public.habit_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  habit_id UUID REFERENCES public.habits(id) ON DELETE CASCADE NOT NULL,
  shared_with UUID REFERENCES public.profiles(id) NOT NULL,
  notify_complete BOOLEAN DEFAULT true,
  notify_miss BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (habit_id, shared_with)
);

-- ── friendships ──

CREATE TABLE public.friendships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  register_id UUID REFERENCES public.profiles(id) NOT NULL,
  addressee_id UUID REFERENCES public.profiles(id) NOT NULL,
  status friendship_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (register_id, addressee_id),
  CHECK (register_id != addressee_id)
);

-- ── encouragements ──

CREATE TABLE public.encouragements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  recipient_id UUID REFERENCES public.profiles(id) NOT NULL,
  encouragement_type encouragement_type DEFAULT 'nudge',
  content TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── groups ──

CREATE TABLE public.groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  invite_code TEXT UNIQUE,
  settings JSONB DEFAULT '{"allow_member_invites": true, "require_approval": false}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── group_members ──

CREATE TABLE public.group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  role group_role DEFAULT 'member',
  notification_prefs JSONB DEFAULT '{"mute_until": null, "notify_completions": true, "notify_messages": true}'::jsonb,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- ── group_habit_shares ──

CREATE TABLE public.group_habit_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  habit_id UUID REFERENCES public.habits(id) ON DELETE CASCADE NOT NULL,
  shared_by UUID REFERENCES public.profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (group_id, habit_id)
);

-- ── group_challenges ──

CREATE TABLE public.group_challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  emoji TEXT DEFAULT '🎯',
  description TEXT,
  color TEXT DEFAULT '#6366F1',
  category TEXT DEFAULT 'general',
  frequency habit_frequency NOT NULL DEFAULT 'daily',
  schedule JSONB DEFAULT '{"days": [1,2,3,4,5,6,0]}'::jsonb,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── group_challenge_participants ──

CREATE TABLE public.group_challenge_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID REFERENCES public.group_challenges(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  habit_id UUID REFERENCES public.habits(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (challenge_id, user_id)
);

-- ── group_messages ──

CREATE TABLE public.group_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_message_content_length CHECK (char_length(content) <= 5000)
);

-- ── group_message_reactions ──

CREATE TABLE public.group_message_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID REFERENCES public.group_messages(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  emoji TEXT NOT NULL DEFAULT '❤️',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

-- ── group_completion_reactions ──

CREATE TABLE public.group_completion_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  completion_id UUID REFERENCES public.completions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) NOT NULL,
  emoji TEXT NOT NULL DEFAULT '❤️',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (completion_id, user_id, emoji)
);

-- ── content_reports ──

CREATE TABLE public.content_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID REFERENCES public.profiles(id) NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('completion', 'message', 'profile', 'group')),
  content_id UUID NOT NULL,
  reason report_reason NOT NULL,
  description TEXT CHECK (char_length(description) <= 2000),
  status report_status DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Rate-limit tracking tables ──

CREATE TABLE IF NOT EXISTS invite_code_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_access_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  accessed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_search_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  searched_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──

CREATE INDEX idx_habits_user_active ON habits (user_id, is_paused);
CREATE INDEX idx_habits_schedule_gin ON habits USING gin (schedule jsonb_path_ops);
CREATE INDEX idx_habits_active_shared ON habits (user_id) WHERE is_paused = false AND is_shared = true;

CREATE INDEX idx_completions_habit_date ON completions (habit_id, completed_at DESC);
CREATE INDEX idx_completions_user_date ON completions (user_id, completed_at DESC);
CREATE INDEX idx_completions_habit_date_key ON completions (habit_id, completed_date DESC);
CREATE INDEX idx_completions_user_date_key ON completions (user_id, completed_date DESC);

CREATE INDEX idx_habit_shares_shared_with ON habit_shares (shared_with);
CREATE INDEX idx_habit_shares_habit_shared ON habit_shares (habit_id, shared_with);
CREATE INDEX idx_habit_shares_habit_id ON habit_shares (habit_id);

CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, status);
CREATE INDEX idx_friendships_register_status ON friendships (register_id, status);

CREATE INDEX idx_encouragements_recipient_unread ON encouragements (recipient_id, is_read) WHERE is_read = false;
CREATE INDEX idx_encouragements_recipient ON encouragements (recipient_id, created_at DESC);
CREATE INDEX idx_encouragements_sender ON encouragements (user_id, created_at DESC);
CREATE INDEX idx_encouragements_user_recipient_created ON encouragements (user_id, recipient_id, created_at DESC);
CREATE INDEX idx_encouragements_recipient_user_created ON encouragements (recipient_id, user_id, created_at DESC);
CREATE INDEX idx_encouragements_recipient_is_read ON encouragements (recipient_id, is_read);

CREATE INDEX idx_profiles_has_push_subscription ON profiles (id) WHERE push_subscription IS NOT NULL;

CREATE INDEX idx_groups_invite_code ON groups (invite_code) WHERE invite_code IS NOT NULL;

CREATE INDEX idx_group_members_user ON group_members (user_id, group_id);
CREATE INDEX idx_group_members_group ON group_members (group_id);
CREATE INDEX idx_group_members_group_user ON group_members (group_id, user_id);

CREATE INDEX idx_group_habit_shares_group ON group_habit_shares (group_id);
CREATE INDEX idx_group_habit_shares_habit ON group_habit_shares (habit_id);
CREATE INDEX idx_group_habit_shares_shared_by ON group_habit_shares (shared_by, group_id);
CREATE INDEX idx_group_habit_shares_habit_group ON group_habit_shares (habit_id, group_id);

CREATE INDEX idx_group_messages_group_time ON group_messages (group_id, created_at DESC);
CREATE INDEX idx_group_messages_group_time_user ON group_messages (group_id, created_at DESC, user_id);

CREATE INDEX idx_group_challenges_group ON group_challenges (group_id);

CREATE INDEX idx_challenge_participants_challenge ON group_challenge_participants (challenge_id);
CREATE INDEX idx_challenge_participants_user ON group_challenge_participants (user_id);
CREATE INDEX idx_challenge_participants_user_habit ON group_challenge_participants (user_id, habit_id);

CREATE INDEX idx_group_message_reactions_message ON group_message_reactions (message_id);

CREATE INDEX idx_group_completion_reactions_completion ON group_completion_reactions (completion_id);

CREATE INDEX idx_content_reports_status_created ON content_reports (status, created_at);

CREATE INDEX idx_invite_attempts_user_time ON invite_code_attempts (user_id, attempted_at DESC);
CREATE INDEX idx_feed_access_user_time ON feed_access_log (user_id, accessed_at DESC);
CREATE INDEX idx_profile_search_user_time ON profile_search_log (user_id, searched_at DESC);
