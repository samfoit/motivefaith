"use client";

import { motion } from "motion/react";
import { Check } from "lucide-react";
import { FriendPicker } from "@/components/social/FriendPicker";
import { GroupPicker } from "@/components/social/GroupPicker";
import { useFriendsList } from "@/lib/hooks/useFriends";
import { useGroupsList } from "@/lib/hooks/useGroups";
import { DEFAULT_HABIT_COLOR } from "@/lib/constants/colors";
import { DEFAULT_TIME_WINDOW } from "@/lib/utils/schedule";
import { SECTION_LABEL, type HabitFieldValues } from "@/components/habits/HabitFields";
import { VisibilityPicker } from "@/components/habits/VisibilityPicker";
import type { HabitVisibility } from "@/lib/types/partners";

// ---------------------------------------------------------------------------
// Form state type (shared with wizard-client)
// ---------------------------------------------------------------------------

/** The habit's own fields (shared with the edit sheet), and who it goes to. */
export interface HabitForm extends HabitFieldValues {
  visibility: HabitVisibility;
  selectedFriends: string[];
  selectedGroups: string[];
}

export const DEFAULT_FORM: HabitForm = {
  title: "",
  emoji: "✅",
  description: "",
  frequency: "daily",
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  timeWindowEnabled: false,
  timeWindowStart: DEFAULT_TIME_WINDOW.start,
  timeWindowEnd: DEFAULT_TIME_WINDOW.end,
  timeWindowExceptions: [],
  color: DEFAULT_HABIT_COLOR,
  visibility: "private",
  selectedFriends: [],
  selectedGroups: [],
};

type Change = (patch: Partial<HabitForm>) => void;

// ---------------------------------------------------------------------------
// Step 2: Partners
// ---------------------------------------------------------------------------

export function StepPartners({
  form,
  onChange,
  userId,
}: {
  form: HabitForm;
  onChange: Change;
  userId: string;
}) {
  const { data: friends, isLoading } = useFriendsList(userId);
  const { data: groups, isLoading: groupsLoading } = useGroupsList(userId);

  const toggleFriend = (friendId: string) => {
    onChange({
      selectedFriends: form.selectedFriends.includes(friendId)
        ? form.selectedFriends.filter((id) => id !== friendId)
        : [...form.selectedFriends, friendId],
    });
  };

  const toggleGroup = (groupId: string) => {
    onChange({
      selectedGroups: form.selectedGroups.includes(groupId)
        ? form.selectedGroups.filter((id) => id !== groupId)
        : [...form.selectedGroups, groupId],
    });
  };

  const inviteCount = form.selectedFriends.length;

  return (
    <div className="space-y-6">
      <section>
        <p className={SECTION_LABEL}>Who can find it</p>
        <VisibilityPicker
          variant="segmented"
          value={form.visibility}
          onChange={(visibility) => onChange({ visibility })}
        />
      </section>

      {/* Partners are invited whatever the visibility — private only means
          nobody can stumble across the habit, not that it is unshareable. */}
      <section>
        <p className={SECTION_LABEL}>Invite partners</p>
        <p className="text-xs text-text-secondary text-pretty mb-3">
          They get an invitation to accept or decline. Nobody sees your progress
          until they say yes.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-brand-ink border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !friends?.length ? (
          <div className="rounded-lg bg-elevated border border-border p-4">
            <p className="text-sm text-text-secondary text-center">
              No friends yet. Add friends from the Friends tab to invite
              partners.
            </p>
          </div>
        ) : (
          <FriendPicker
            friends={friends.map((f) => f.profile)}
            selectedIds={form.selectedFriends}
            onToggle={toggleFriend}
            mode="multi"
            searchPlaceholder="Search friends…"
          />
        )}
      </section>

      {/* Group sharing is a push into a room you are both already in, so it
          needs no invitation. */}
      {!groupsLoading && groups && groups.length > 0 && (
        <section>
          <p className={SECTION_LABEL}>Share with groups</p>
          <GroupPicker
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              avatar_url: g.avatar_url,
              memberCount: g.memberCount,
            }))}
            selectedIds={form.selectedGroups}
            onToggle={toggleGroup}
            searchPlaceholder="Search groups…"
          />
        </section>
      )}

      {/* The pickers count what is picked; this only answers whether picking
          anyone is required. */}
      {inviteCount === 0 && form.selectedGroups.length === 0 && (
        <p className="text-xs text-text-tertiary">
          This step is optional, and you can change any of it later.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success screen
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = [
  "#6366F1",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#3B82F6",
  "#14B8A6",
];

const CONFETTI_PARTICLES = Array.from({ length: 24 }, (_, i) => ({
  radius: 100 + ((((i * 7 + 13) * 2654435761) >>> 0) % 100) * 0.8,
  duration: 0.8 + ((((i * 11 + 7) * 2654435761) >>> 0) % 100) * 0.004,
  delay: ((((i * 3 + 19) * 2654435761) >>> 0) % 100) * 0.0015,
  angle: (i / 24) * Math.PI * 2,
}));

export function SuccessScreen({ form }: { form: HabitForm }) {
  return (
    <div className="flex items-center justify-center px-4" style={{ minHeight: "calc(100dvh - 3.5rem - 6rem)" }}>
      <div className="text-center relative">
        {/* Confetti particles */}
        {CONFETTI_PARTICLES.map((p, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full left-1/2 top-1/2"
            style={{
              backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{
              x: Math.cos(p.angle) * p.radius,
              y: Math.sin(p.angle) * p.radius,
              scale: 0,
              opacity: 0,
            }}
            transition={{
              duration: p.duration,
              ease: "easeOut",
              delay: p.delay,
            }}
          />
        ))}

        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
          className="w-20 h-20 rounded-full bg-brand flex items-center justify-center mx-auto mb-6"
        >
          <Check className="w-10 h-10 text-on-brand" strokeWidth={3} />
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="font-display font-medium text-[var(--color-text-primary)] mb-2"
          style={{ fontSize: "var(--text-xl)" }}
        >
          Habit created!
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="flex items-center justify-center gap-2 text-[var(--color-text-secondary)]"
        >
          <span className="text-2xl">{form.emoji}</span>
          <span className="font-medium">{form.title}</span>
        </motion.div>
      </div>
    </div>
  );
}
