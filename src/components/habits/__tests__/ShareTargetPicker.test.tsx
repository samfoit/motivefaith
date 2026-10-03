import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import {
  ShareTargetPicker,
  SelectedTargets,
  type PickerFriend,
  type PickerHabit,
} from "../ShareTargetPicker";
import type { ShareTarget } from "@/lib/stores/quick-capture-store";

const HABITS: PickerHabit[] = [
  { id: "h1", title: "Pray", emoji: "🙏", color: null, streak_current: 3, frequency: "daily" },
  { id: "h2", title: "Sabbath", emoji: "🕯️", color: null, streak_current: 4, frequency: "weekly" },
];
const FRIENDS: PickerFriend[] = Array.from({ length: 12 }, (_, i) => ({
  id: `f${i}`,
  display_name: i === 11 ? "Zed Prayerful" : `Friend ${i}`,
  username: `friend${i}`,
  avatar_url: null,
}));
const GROUPS = [
  { id: "g1", name: "Prayer Circle", avatar_url: null, memberCount: 4 },
];

function Harness() {
  const [selected, setSelected] = useState<Record<ShareTarget, string[]>>({
    habit: [],
    friend: [],
    group: [],
  });
  const toggle = (kind: ShareTarget, id: string) =>
    setSelected((s) => ({
      ...s,
      [kind]: s[kind].includes(id)
        ? s[kind].filter((x) => x !== id)
        : [...s[kind], id],
    }));
  const props = { habits: HABITS, friends: FRIENDS, groups: GROUPS, selected, onToggle: toggle };
  return (
    <>
      <ShareTargetPicker {...props} habitsLoading={false} />
      <SelectedTargets {...props} />
    </>
  );
}

describe("ShareTargetPicker", () => {
  it("previews long sections on All and shows everything on that tab", async () => {
    render(<Harness />);
    expect(screen.queryByText("Friend 7")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all 12 friends" }));

    expect(screen.getByRole("tab", { name: "Friends" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Friend 7")).toBeInTheDocument();
    expect(screen.queryByText("Pray")).not.toBeInTheDocument();
  });

  it("one search covers habits, friends and groups", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Search habits/), "pray");

    expect(screen.getByText("Pray")).toBeInTheDocument();
    expect(screen.getByText("Zed Prayerful")).toBeInTheDocument();
    expect(screen.getByText("Prayer Circle")).toBeInTheDocument();
    expect(screen.queryByText("Friend 0")).not.toBeInTheDocument();
  });

  it("shows picks as chips with per-tab counts, and a chip removes its pick", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Friend 0/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Prayer Circle/ }));

    const chips = screen.getByRole("list", { name: "Selected" });
    expect(within(chips).getAllByRole("button")).toHaveLength(2);
    expect(within(screen.getByRole("tab", { name: /Friends/ })).getByText("1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove Friend 0" }));
    expect(screen.getByRole("checkbox", { name: /Friend 0/ })).toHaveAttribute("aria-checked", "false");
  });

  it("speaks a weekly habit's streak in weeks", () => {
    render(<Harness />);
    expect(screen.getByLabelText("3-day streak")).toBeInTheDocument();
    expect(screen.getByLabelText("4-week streak")).toBeInTheDocument();
  });
});
