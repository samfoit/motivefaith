"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { ActivityDot } from "@/components/ui/ActivityDot";
import { useTimeAgo } from "@/lib/hooks/useTimeAgo";
import type { FriendFeedRow } from "@/lib/types/feed";

interface FriendRowProps {
  row: FriendFeedRow;
  className?: string;
}

export const FriendRow = React.memo(function FriendRow({
  row,
  className,
}: FriendRowProps) {
  const { friend, sharedHabits, latestActivity, previewText, hasNewActivity } =
    row;

  const timeAgo = useTimeAgo(latestActivity);

  return (
    <Link href={`/main/feed/${friend.id}`} className="block">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 shadow-sm transition-all hover:bg-[var(--color-surface-hover)] active:scale-[0.98]",
          className,
        )}
      >
        {/* Avatar */}
        <Avatar
          src={friend.avatar_url}
          name={friend.display_name}
          size="md"
        />

        {/* Middle content */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm truncate text-[var(--color-text-primary)]",
              hasNewActivity ? "font-bold" : "font-medium",
            )}
          >
            {friend.display_name}
          </p>

          {/* Shared habit emojis */}
          {sharedHabits.length > 0 && (
            <div className="flex items-center gap-0.5 mt-0.5">
              {sharedHabits.slice(0, 5).map((h) => (
                <span key={h.title} className="text-xs" title={h.title}>
                  {h.emoji}
                </span>
              ))}
              {sharedHabits.length > 5 && (
                <span className="text-xs text-[var(--color-text-tertiary)] ml-0.5">
                  +{sharedHabits.length - 5}
                </span>
              )}
            </div>
          )}

          {/* Preview text + time */}
          <p className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
            {previewText}
            {timeAgo && <>{" · "}{timeAgo}</>}
          </p>
        </div>

        {/* Right side: new activity dot + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasNewActivity && <ActivityDot />}
          <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        </div>
      </div>
    </Link>
  );
});
