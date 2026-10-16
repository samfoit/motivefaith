import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SharedHabits, type SharedHabitChip } from "../SharedHabits";

function chip(over: Partial<SharedHabitChip> & { id: string; title: string }): SharedHabitChip {
  return {
    emoji: "✅",
    color: "#6366F1",
    streak_current: 0,
    isOwner: false,
    completedToday: false,
    dueToday: true,
    ownerName: "Bob",
    ...over,
  };
}

const titles = () =>
  screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")?.split(" — ")[0]);

describe("SharedHabits (today's strip)", () => {
  it("shows only what's due today", () => {
    render(
      <SharedHabits
        habits={[
          chip({ id: "1", title: "Pray" }),
          chip({ id: "2", title: "Long run", dueToday: false }),
        ]}
      />,
    );
    expect(titles()).toEqual(["Pray"]);
  });

  it("leads with what's still open, theirs before yours, done last", () => {
    render(
      <SharedHabits
        habits={[
          chip({ id: "1", title: "Done", completedToday: true }),
          chip({ id: "2", title: "Mine open", isOwner: true, ownerName: "Sam" }),
          chip({ id: "3", title: "Skipped", rainCheckedToday: true }),
          chip({ id: "4", title: "Theirs open" }),
        ]}
      />,
    );
    expect(titles()).toEqual(["Theirs open", "Mine open", "Skipped", "Done"]);
  });

  it("is hidden when nothing is due", () => {
    const { container } = render(
      <SharedHabits habits={[chip({ id: "1", title: "Long run", dueToday: false })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
