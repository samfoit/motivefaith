"use client";

import React, { memo, useMemo, useState } from "react";
import { Check, Target, UserRound, Users, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  HabitCircle,
  HabitTitleRow,
  habitSurfaceProps,
} from "@/components/habits/HabitCardParts";
import type { ShareTarget } from "@/lib/stores/quick-capture-store";
import type { Habit } from "@/lib/types/habit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickerHabit {
  id: string;
  title: string;
  emoji: string | null;
  color: string | null;
  streak_current: number;
  frequency: Habit["frequency"];
}

export interface PickerFriend {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
}

export interface PickerGroup {
  id: string;
  name: string;
  avatar_url: string | null;
  memberCount: number;
}

interface Item {
  kind: ShareTarget;
  id: string;
  title: string;
  subtitle: string | null;
  /** Lower-cased text the search box matches against. */
  haystack: string;
  leading: React.ReactNode;
  /** Set on habit items, which draw as a dashboard habit card instead. */
  habit?: PickerHabit;
}

type Tab = "all" | ShareTarget;

interface ShareTargetPickerProps {
  habits: PickerHabit[];
  habitsLoading: boolean;
  friends: PickerFriend[];
  groups: PickerGroup[];
  selected: Record<ShareTarget, string[]>;
  onToggle: (kind: ShareTarget, id: string) => void;
}

/** How many rows each section shows on the "All" tab before "Show all". */
const PREVIEW_COUNT = 5;

const SECTIONS: {
  kind: ShareTarget;
  label: string;
  plural: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { kind: "habit", label: "Habits", plural: "habits", icon: Target },
  { kind: "friend", label: "Friends", plural: "friends", icon: UserRound },
  { kind: "group", label: "Groups", plural: "groups", icon: Users },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * One list for every place a capture can go. Built for long friend and group
 * lists on a phone: a single search across all three kinds, tabs to narrow to
 * one, and one scroll container — no list scrolling inside another list.
 *
 * The parent owns the scroll container; this renders the sticky search/tabs
 * header and the rows inside it.
 */
export function ShareTargetPicker({
  habits,
  habitsLoading,
  friends,
  groups,
  selected,
  onToggle,
}: ShareTargetPickerProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  const items = useMemo<Record<ShareTarget, Item[]>>(
    () => ({
      habit: habits.map((h) => ({
        kind: "habit",
        id: h.id,
        title: h.title,
        subtitle: null,
        haystack: h.title.toLowerCase(),
        leading: null,
        habit: h,
      })),
      friend: friends.map((f) => ({
        kind: "friend",
        id: f.id,
        title: f.display_name,
        subtitle: `@${f.username}`,
        haystack: `${f.display_name} ${f.username}`.toLowerCase(),
        leading: <Avatar src={f.avatar_url} name={f.display_name} size="sm" />,
      })),
      group: groups.map((g) => ({
        kind: "group",
        id: g.id,
        title: g.name,
        subtitle: `${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`,
        haystack: g.name.toLowerCase(),
        leading: g.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={g.avatar_url}
            alt=""
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <span className="w-8 h-8 rounded-full bg-brand-light flex items-center justify-center">
            <Users className="w-4 h-4 text-brand" />
          </span>
        ),
      })),
    }),
    [habits, friends, groups],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      Object.fromEntries(
        SECTIONS.map(({ kind }) => [
          kind,
          q ? items[kind].filter((i) => i.haystack.includes(q)) : items[kind],
        ]),
      ) as Record<ShareTarget, Item[]>,
    [items, q],
  );

  const visibleSections = SECTIONS.filter(
    ({ kind }) =>
      (tab === "all" || tab === kind) &&
      // Keep the habits section on screen while loading or when it's simply
      // done for the day; hide the others when the user has none.
      (filtered[kind].length > 0 || (kind === "habit" && !q)),
  );

  return (
    <div>
      {/* Sticky header: search + tabs stay reachable however far you scroll */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 bg-bg-primary space-y-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search habits, friends, groups…"
        />
        <div
          role="tablist"
          aria-label="Filter destinations"
          className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4"
        >
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All
          </TabButton>
          {SECTIONS.map(({ kind, label }) => (
            <TabButton
              key={kind}
              active={tab === kind}
              onClick={() => setTab(kind)}
              count={selected[kind].length}
            >
              {label}
            </TabButton>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {visibleSections.length === 0 && (
          <p className="text-sm text-text-tertiary text-center py-10">
            No matches for &ldquo;{query}&rdquo;
          </p>
        )}

        {visibleSections.map(({ kind, label, plural, icon: Icon }) => {
          const rows = filtered[kind];
          // Searching or on a single tab shows everything; "All" previews.
          const capped = tab === "all" && !q && rows.length > PREVIEW_COUNT;
          const shown = capped ? rows.slice(0, PREVIEW_COUNT) : rows;

          return (
            <section key={kind} aria-label={label}>
              {tab === "all" && (
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-text-secondary" />
                  <h3 className="text-sm font-medium text-text-primary">
                    {label}
                  </h3>
                </div>
              )}

              {kind === "habit" && habitsLoading ? (
                <p className="text-sm text-text-secondary py-3">
                  Loading habits…
                </p>
              ) : kind === "habit" && rows.length === 0 ? (
                <p className="text-sm text-text-secondary py-3">
                  All done for today!
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {shown.map((item) => {
                    const Row = item.habit ? HabitTargetRow : TargetRow;
                    return (
                      <Row
                        key={item.id}
                        item={item}
                        selected={selected[kind].includes(item.id)}
                        onToggle={onToggle}
                      />
                    );
                  })}
                </ul>
              )}

              {capped && (
                <button
                  type="button"
                  onClick={() => setTab(kind)}
                  className="mt-2 w-full min-h-11 rounded-lg text-sm font-medium text-brand hover:bg-surface-hover"
                >
                  Show all {rows.length} {plural}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selected chips — for the parent's bottom bar
// ---------------------------------------------------------------------------

/**
 * What's picked, as removable chips, so a selection made three screens of
 * scrolling ago is still visible next to the Send button.
 */
export function SelectedTargets({
  habits,
  friends,
  groups,
  selected,
  onToggle,
}: Omit<ShareTargetPickerProps, "habitsLoading">) {
  const chips = useMemo(() => {
    const habitById = new Map(habits.map((h) => [h.id, `${h.emoji} ${h.title}`]));
    const friendById = new Map(friends.map((f) => [f.id, f.display_name]));
    const groupById = new Map(groups.map((g) => [g.id, g.name]));
    const label = { habit: habitById, friend: friendById, group: groupById };

    return SECTIONS.flatMap(({ kind }) =>
      selected[kind].map((id) => ({
        kind,
        id,
        label: label[kind].get(id) ?? "…",
      })),
    );
  }, [habits, friends, groups, selected]);

  if (chips.length === 0) return null;

  return (
    <ul
      aria-label="Selected"
      className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 pb-3"
    >
      {chips.map((chip) => (
        <li key={`${chip.kind}:${chip.id}`} className="shrink-0">
          <button
            type="button"
            onClick={() => onToggle(chip.kind, chip.id)}
            aria-label={`Remove ${chip.label}`}
            className="flex items-center gap-1 max-w-[12rem] min-h-9 pl-3 pr-2 rounded-full bg-brand-light text-sm text-text-primary"
          >
            <span className="truncate">{chip.label}</span>
            <X className="w-3.5 h-3.5 shrink-0 text-text-secondary" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  count = 0,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "shrink-0 min-h-9 px-4 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5",
        active
          ? "bg-brand text-white"
          : "bg-bg-secondary text-text-secondary hover:bg-surface-hover",
      )}
    >
      {children}
      {count > 0 && (
        <span
          className={cn(
            "min-w-5 h-5 px-1 rounded-full text-xs flex items-center justify-center",
            active ? "bg-white/25" : "bg-brand text-white",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

type RowProps = {
  item: Item;
  selected: boolean;
  onToggle: (kind: ShareTarget, id: string) => void;
};

/**
 * A habit, drawn with the dashboard card's own pieces so the two cannot drift
 * apart. Picking it fills the same circle completing it on the dashboard does
 * — which is what sending to it will do.
 */
const HabitTargetRow = memo(function HabitTargetRow({
  item,
  selected,
  onToggle,
}: RowProps) {
  const habit = item.habit!;
  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_68px]">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={habit.title}
        onClick={() => onToggle(item.kind, item.id)}
        {...habitSurfaceProps(habit.color, {
          className: "group w-full pl-4 text-left active:brightness-[0.98]",
        })}
      >
        <span className="flex-1 min-w-0">
          <HabitTitleRow
            emoji={habit.emoji}
            title={habit.title}
            streak={habit.streak_current}
            frequency={habit.frequency}
            titleAs="span"
          />
        </span>
        <HabitCircle state={selected ? "done" : "open"} />
      </button>
    </li>
  );
});

/**
 * Memoised so toggling one row doesn't re-render a few hundred others, and
 * `content-visibility: auto` lets the browser skip laying out rows that are
 * off screen — enough for long friend lists without a virtualisation library.
 */
const TargetRow = memo(function TargetRow({
  item,
  selected,
  onToggle,
}: RowProps) {
  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_64px]">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(item.kind, item.id)}
        className={cn(
          "w-full min-h-16 flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors active:scale-[0.99]",
          selected
            ? "bg-brand-light"
            : "bg-bg-secondary hover:bg-surface-hover",
        )}
      >
        <span className="shrink-0">{item.leading}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-text-primary truncate">
            {item.title}
          </span>
          {item.subtitle && (
            <span className="block text-xs text-text-secondary truncate">
              {item.subtitle}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={cn(
            "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
            selected ? "bg-brand border-brand" : "border-text-tertiary",
          )}
        >
          {selected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </span>
      </button>
    </li>
  );
});
