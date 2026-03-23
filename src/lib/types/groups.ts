// ---------------------------------------------------------------------------
// Group (Accountability Circle) types
// ---------------------------------------------------------------------------

import type { FeedProfile } from "./feed";
import type { Database } from "@/lib/supabase/types";

/** Core group entity */
export type Group = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string;
  invite_code: string | null;
  settings: {
    allow_member_invites: boolean;
    require_approval: boolean;
  };
  created_at: string | null;
  updated_at: string | null;
};

/** Group member row */
export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  role: "admin" | "member" | null;
  notification_prefs: {
    mute_until: string | null;
    notify_completions: boolean;
    notify_messages: boolean;
  } | null;
  joined_at: string | null;
};

/** Group member with profile info */
export type GroupMemberProfile = GroupMember & {
  profile: FeedProfile;
};

/** A habit shared to a group */
export type GroupHabitShare = {
  id: string;
  group_id: string;
  habit_id: string;
  shared_by: string;
  created_at: string | null;
};

/** A group challenge template */
export type GroupChallenge = {
  id: string;
  group_id: string;
  title: string;
  emoji: string | null;
  description: string | null;
  color: string | null;
  category: string | null;
  frequency: Database["public"]["Enums"]["habit_frequency"];
  schedule: { days: number[] } | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean | null;
  created_by: string;
  created_at: string | null;
};

/** A challenge participant */
export type GroupChallengeParticipant = {
  id: string;
  challenge_id: string;
  user_id: string;
  habit_id: string | null;
  joined_at: string | null;
};

/** A message in a group chat */
export type GroupMessage = {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

/** A reaction on a group message */
export type GroupMessageReaction = {
  id: string;
  user_id: string;
  emoji: string;
};

// ---------------------------------------------------------------------------
// Feed-level aggregate — appears in the feed list alongside FriendFeedRow
// ---------------------------------------------------------------------------

/** A single row in the group feed list */
export type GroupFeedRow = {
  group: Pick<Group, "id" | "name" | "avatar_url">;
  memberCount: number;
  /** Preview text for the latest activity (message or completion) */
  previewText: string;
  /** ISO timestamp of latest activity */
  latestActivity: string | null;
  /** Whether there's unread activity */
  hasNewActivity: boolean;
  /** Current user's role in this group */
  myRole: "admin" | "member";
};

// ---------------------------------------------------------------------------
// Timeline types — used by the group detail page
// ---------------------------------------------------------------------------

/** A completion entry in the group timeline */
export type GroupTimelineCompletion = {
  id: string;
  habit_id: string;
  completion_type: "photo" | "video" | "message" | "quick";
  evidence_url: string | null;
  notes: string | null;
  completed_at: string;
  user_id: string;
  isMe: boolean;
  /** Denormalized user info */
  user_name: string;
  user_avatar: string | null;
  /** Denormalized habit info */
  habit_emoji: string;
  habit_title: string;
  habit_color: string;
  reactions?: GroupMessageReaction[];
};

/** A message entry in the group timeline */
export type GroupTimelineMessage = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  isMe: boolean;
  user_name: string;
  user_avatar: string | null;
  reactions?: GroupMessageReaction[];
};

/** Full data for the group timeline page */
export type GroupTimelineData = {
  group: Group;
  members: GroupMemberProfile[];
  habits: {
    id: string;
    title: string;
    emoji: string;
    color: string;
    category: string;
    streak_current: number;
    owner_id: string;
    owner_name: string;
    owner_avatar: string | null;
    completedToday: boolean;
  }[];
  completions: GroupTimelineCompletion[];
  messages: GroupTimelineMessage[];
  challenges: (GroupChallenge & {
    participants: (GroupChallengeParticipant & {
      profile: FeedProfile;
    })[];
    myParticipation: GroupChallengeParticipant | null;
  })[];
  myRole: "admin" | "member";
};
