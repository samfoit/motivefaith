"use client";

import { ChevronRight, Link2, LogOut, Settings } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import type { GroupMemberProfile } from "@/lib/types/groups";
import { SharedHabitRows, type SharedHabitChip } from "@/components/social/SharedHabits";
import {
  GroupChallenges,
  type GroupChallengeWithParticipants,
} from "@/components/social/GroupChallenges";

interface GroupInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  members: GroupMemberProfile[];
  userId: string;
  isAdmin: boolean;
  onInvite: () => void;
  onSettings: () => void;
  onLeave: () => void;
  habits: SharedHabitChip[];
  challenges: GroupChallengeWithParticipants[];
  onJoinChallenge: (challengeId: string) => void;
  onLeaveChallenge: (challengeId: string) => void;
  pendingChallengeId?: string | null;
  /** Admins only. */
  onCreateChallenge?: () => void;
}

/**
 * What tapping a group chat's name opens, as in any messaging app: who is in
 * it, what it shares, and what you can do with it. The chat's own strip shows
 * only today's habits; the full list and the challenges are reference, and
 * live here. Invite, settings and leave used to be icons in the top bar
 * beside the name, which left a long name truncated to a few words; the bar
 * keeps only the camera, the one thing used mid-conversation.
 */
export function GroupInfoSheet({
  open,
  onOpenChange,
  name,
  members,
  userId,
  isAdmin,
  onInvite,
  onSettings,
  onLeave,
  habits,
  challenges,
  onJoinChallenge,
  onLeaveChallenge,
  pendingChallengeId,
  onCreateChallenge,
}: GroupInfoSheetProps) {
  const yours = habits.filter((h) => h.isOwner);
  const others = habits.filter((h) => !h.isOwner);

  // Each action closes this sheet first, so the next one never opens over it.
  const then = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={name}
      description={`${members.length} ${members.length === 1 ? "member" : "members"}`}
    >
      <div className="space-y-6 pb-4">
        <div className="rounded-lg bg-bg-secondary divide-y divide-border overflow-hidden">
          <ActionRow icon={Link2} label="Invite with a link" onClick={then(onInvite)} />
          {isAdmin ? (
            <ActionRow icon={Settings} label="Group settings" onClick={then(onSettings)} chevron />
          ) : (
            <ActionRow icon={LogOut} label="Leave group" onClick={then(onLeave)} danger />
          )}
        </div>

        {(challenges.length > 0 || onCreateChallenge) && (
          <Section label="Challenges">
            <GroupChallenges
              challenges={challenges}
              onJoin={onJoinChallenge}
              onLeave={onLeaveChallenge}
              pendingId={pendingChallengeId}
              onCreate={onCreateChallenge && then(onCreateChallenge)}
            />
          </Section>
        )}

        {yours.length > 0 && (
          <Section label="Your shared habits">
            <SharedHabitRows habits={yours} />
          </Section>
        )}

        {others.length > 0 && (
          <Section label="Everyone else's">
            <SharedHabitRows habits={others} showOwner />
          </Section>
        )}

        <Section label="Members">
          <ul className="space-y-3">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 min-w-0">
                <Avatar src={m.profile.avatar_url} name={m.profile.display_name} size="sm" />
                <span className="flex-1 min-w-0 truncate text-sm text-text-primary">
                  {m.profile.display_name}
                  {m.user_id === userId && (
                    <span className="text-text-tertiary"> (you)</span>
                  )}
                </span>
                {m.role === "admin" && (
                  <span className="shrink-0 text-xs text-text-tertiary">Admin</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium text-text-secondary">{label}</h3>
      {children}
    </section>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  chevron = false,
  danger = false,
}: {
  icon: typeof Link2;
  label: string;
  onClick: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors hover:bg-surface-hover",
        danger ? "text-miss" : "text-text-primary",
      )}
    >
      <Icon className={cn("w-5 h-5 shrink-0", danger ? "text-miss" : "text-text-secondary")} />
      <span className="flex-1">{label}</span>
      {chevron && <ChevronRight className="w-4 h-4 text-text-tertiary" />}
    </button>
  );
}
