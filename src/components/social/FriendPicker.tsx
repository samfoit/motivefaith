"use client";

import { useState, useMemo } from "react";
import { Check, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PickableFriend = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

interface FriendPickerProps {
  /** All friends available to pick from */
  friends: PickableFriend[];
  /** Currently selected friend IDs */
  selectedIds: string[];
  /** Called when selection changes */
  onToggle: (friendId: string) => void;
  /** If true, show a loading spinner for a specific friend */
  loadingId?: string | null;
  /** Whether this is a multi-select (checkboxes) or single-tap (add buttons) */
  mode?: "multi" | "single";
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Called on single-tap when mode="single" */
  onAdd?: (friendId: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FriendPicker({
  friends,
  selectedIds,
  onToggle,
  loadingId,
  mode = "multi",
  searchPlaceholder = "Search friends…",
  onAdd,
  className,
}: FriendPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return friends;
    const q = query.toLowerCase();
    return friends.filter(
      (f) =>
        f.display_name.toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q),
    );
  }, [friends, query]);

  if (friends.length === 0) {
    return (
      <EmptyState message="No friends available to add." className={className} />
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Search — only show when there are enough friends to warrant it */}
      {friends.length > 4 && (
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
          filtered.map((friend) => {
            const isSelected = selectedIds.includes(friend.id);
            const isLoading = loadingId === friend.id;

            if (mode === "single") {
              return (
                <button
                  key={friend.id}
                  type="button"
                  disabled={isSelected || isLoading}
                  onClick={() => onAdd?.(friend.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-elevated shadow-sm hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 text-left"
                >
                  <Avatar
                    src={friend.avatar_url}
                    name={friend.display_name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {friend.display_name}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      @{friend.username}
                    </p>
                  </div>
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  ) : isSelected ? (
                    <Check className="w-4 h-4 text-success flex-shrink-0" />
                  ) : (
                    <UserPlus className="w-4 h-4 text-brand flex-shrink-0" />
                  )}
                </button>
              );
            }

            // Multi-select mode
            return (
              <button
                key={friend.id}
                type="button"
                onClick={() => onToggle(friend.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left",
                  isSelected
                    ? "bg-brand-light ring-2 ring-brand"
                    : "bg-[var(--color-bg-secondary)] hover:bg-[var(--color-surface-hover)]",
                )}
              >
                <Avatar
                  src={friend.avatar_url}
                  name={friend.display_name}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {friend.display_name}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] truncate">
                    @{friend.username}
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

      {/* Selection count for multi mode */}
      {mode === "multi" && selectedIds.length > 0 && (
        <p className="text-xs text-[var(--color-text-tertiary)] text-center">
          {selectedIds.length} friend{selectedIds.length === 1 ? "" : "s"} selected
        </p>
      )}
    </div>
  );
}
