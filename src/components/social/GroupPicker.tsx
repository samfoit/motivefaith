"use client";

import { useState, useMemo } from "react";
import { Check, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PickableGroup = {
  id: string;
  name: string;
  avatar_url: string | null;
  memberCount: number;
};

interface GroupPickerProps {
  groups: PickableGroup[];
  selectedIds: string[];
  onToggle: (groupId: string) => void;
  searchPlaceholder?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupPicker({
  groups,
  selectedIds,
  onToggle,
  searchPlaceholder = "Search groups\u2026",
  className,
}: GroupPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    const q = query.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  if (groups.length === 0) {
    return (
      <EmptyState message="No groups available." className={className} />
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Search */}
      {groups.length > 4 && (
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={searchPlaceholder}
        />
      )}

      {/* List */}
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)] text-center py-4">
            No matches for &ldquo;{query}&rdquo;
          </p>
        ) : (
          filtered.map((group) => {
            const isSelected = selectedIds.includes(group.id);

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onToggle(group.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                  isSelected
                    ? "bg-brand-light ring-2 ring-brand"
                    : "bg-[var(--color-bg-secondary)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                {group.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={group.avatar_url}
                    alt={group.name}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-brand-light flex items-center justify-center flex-shrink-0">
                    <Users className="w-4 h-4 text-brand" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {group.name}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0",
                    isSelected
                      ? "bg-brand border-brand"
                      : "border-gray-300",
                  )}
                >
                  {isSelected && (
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Selection count */}
      {selectedIds.length > 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)] text-center">
          {selectedIds.length} group{selectedIds.length === 1 ? "" : "s"} selected
        </p>
      )}
    </div>
  );
}
