"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Badge";
import { ActivityDot } from "@/components/ui/ActivityDot";
import { useTimeAgo } from "@/lib/hooks/useTimeAgo";
import type { GroupFeedRow } from "@/lib/types/groups";

interface GroupRowProps {
  row: GroupFeedRow;
  className?: string;
}

export const GroupRow = React.memo(function GroupRow({
  row,
  className,
}: GroupRowProps) {
  const { group, memberCount, previewText, latestActivity, hasNewActivity } =
    row;

  const timeAgo = useTimeAgo(latestActivity);

  return (
    <Link href={`/main/feed/group/${group.id}`} className="block">
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 shadow-sm transition-all hover:bg-[var(--color-surface-hover)] active:scale-[0.98]",
          className,
        )}
      >
        {/* Group avatar or icon */}
        {group.avatar_url ? (
          <Avatar
            src={group.avatar_url}
            name={group.name}
            size="md"
            className="flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-brand-light flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-brand" />
          </div>
        )}

        {/* Middle content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "text-sm truncate text-[var(--color-text-primary)]",
                hasNewActivity ? "font-bold" : "font-medium",
              )}
            >
              {group.name}
            </p>
            <Pill size="sm" variant="default">
              {memberCount}
            </Pill>
          </div>

          {/* Preview text + time */}
          <p className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
            {previewText}
            {timeAgo && <>{" · "}{timeAgo}</>}
          </p>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasNewActivity && <ActivityDot />}
          <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        </div>
      </div>
    </Link>
  );
});
