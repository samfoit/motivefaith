import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Json } from "@/lib/supabase/types";
import { WeekDays } from "../WeekDays";

const WEEK = "2026-11-01"; // a Sunday
const MONDAY = "2026-11-02";

/** A week as 051 saves it: Monday has a run done and a missed reading; Sunday predates both. */
const DAYS: Json = {
  "2026-11-01": [],
  "2026-11-02": [
    { habit_id: "h1", title: "Run", emoji: "🏃", weekly: false, status: "done", times: ["06:45"], reason: null },
    { habit_id: "h2", title: "Read", emoji: "📖", weekly: false, status: "missed", times: [], reason: null },
  ],
  "2026-11-03": [],
  "2026-11-04": [],
  "2026-11-05": [],
  "2026-11-06": [],
  "2026-11-07": [],
};

const COUNTS = { "2026-11-02": 1 };

function renderDays(days: Json | undefined, initialDay: string | null = null) {
  return render(
    <WeekDays weekStart={WEEK} counts={COUNTS} days={days as Json} initialDay={initialDay} />,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/main/dashboard/weekly/2026-11-01");
});

describe("WeekDays", () => {
  it("lists a day's habits under what became of them", () => {
    renderDays(DAYS);
    fireEvent.click(screen.getByRole("button", { name: /Monday, Nov 2: 1 check-in/ }));

    const panel = screen.getByText("Monday, Nov 2").parentElement!;
    expect(within(panel).getByText("Done")).toBeInTheDocument();
    expect(within(panel).getByText("Run")).toBeInTheDocument();
    expect(within(panel).getByText("6:45 AM")).toBeInTheDocument();
    expect(within(panel).getByText("Not done")).toBeInTheDocument();
    expect(within(panel).getByText("Read")).toBeInTheDocument();
    expect(within(panel).getByText("Missed")).toBeInTheDocument();
  });

  it("says a day had no habits yet only when the week holds an empty list for it", () => {
    renderDays(DAYS, "2026-11-01");
    expect(screen.getByText("No habits yet on this day.")).toBeInTheDocument();
  });

  it("does not call a week saved without its days a week with no habits", () => {
    // What production's API returned before 057: counts for the strip, and
    // no `days` at all. Every day then read "No habits yet on this day",
    // under a strip showing that day's check-ins.
    renderDays(undefined);
    fireEvent.click(screen.getByRole("button", { name: /Monday, Nov 2: 1 check-in/ }));

    expect(screen.getByText("This day’s habits weren’t saved with the week.")).toBeInTheDocument();
    expect(screen.queryByText("No habits yet on this day.")).not.toBeInTheDocument();
  });

  it("says the same of a week whose days came back empty", () => {
    renderDays({}, MONDAY);
    expect(screen.getByText("This day’s habits weren’t saved with the week.")).toBeInTheDocument();
  });

  it("puts the chosen day in the address, and takes it out when unchosen", () => {
    renderDays(DAYS);
    const monday = screen.getByRole("button", { name: /Monday, Nov 2/ });

    fireEvent.click(monday);
    expect(window.location.search).toBe(`?day=${MONDAY}`);
    expect(monday).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(monday);
    expect(window.location.search).toBe("");
    expect(screen.getByText("Tap a day to see what you did.")).toBeInTheDocument();
  });
});
