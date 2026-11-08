import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EncouragementPrompt } from "../EncouragementPrompt";
import { forgetLateHabitDismissals } from "@/lib/stores/late-habit-dismissals";
import type { LateHabit } from "@/lib/types/late-habits";

// Saturday 7 November 2026, 6 PM on this machine's clock.
const NOW = new Date(2026, 10, 7, 18, 0);
const TODAY = "2026-11-07";
const YESTERDAY = "2026-11-06";

let next = 0;

function late(overrides: Partial<LateHabit> = {}): LateHabit {
  next += 1;
  return {
    habitId: `habit-${next}`,
    title: "Morning Run",
    emoji: "🏃",
    color: "#EF4444",
    ownerId: "alice",
    ownerName: "Alice Johnson",
    ownerAvatar: null,
    kind: "remind",
    day: TODAY,
    closedAt: new Date(2026, 10, 7, 10, 0).toISOString(),
    ...overrides,
  };
}

const card = () => screen.queryByRole("region", { name: "Only you can see this" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  forgetLateHabitDismissals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EncouragementPrompt", () => {
  it("shows nothing when no one needs a word", () => {
    const { container } = render(<EncouragementPrompt habits={[]} lastSentAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists what a friend could use a word about, for you alone, with no message written for you", () => {
    render(
      <EncouragementPrompt
        habits={[
          late(),
          late({
            title: "Vitamins",
            emoji: "💊",
            kind: "encourage",
            day: YESTERDAY,
            closedAt: new Date(2026, 10, 6, 12, 0).toISOString(),
          }),
        ]}
        lastSentAt={null}
      />,
    );

    expect(card()).toBeInTheDocument();
    expect(screen.getByText("Only you can see this")).toBeInTheDocument();
    expect(screen.getByText("Morning Run")).toBeInTheDocument();
    expect(screen.getByText("Not logged yet · ended 10 AM")).toBeInTheDocument();
    expect(screen.getByText("Vitamins")).toBeInTheDocument();
    expect(screen.getByText("Missed yesterday")).toBeInTheDocument();
    // In a friend's chat, it's theirs: no name on each row.
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument();
    // The only control is the dismissal; what to say is yours.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("lists a group's under each person, once, however many of theirs are late", () => {
    render(
      <EncouragementPrompt
        habits={[
          late(),
          late({ title: "Read", emoji: "📖" }),
          late({ ownerId: "sam", ownerName: "Sam Lee", title: "Stretch", emoji: "🧘" }),
        ]}
        showOwners
        lastSentAt={null}
      />,
    );

    expect(screen.getAllByText("Alice Johnson")).toHaveLength(1);
    expect(screen.getByText("🏃 Morning Run")).toBeInTheDocument();
    expect(screen.getByText("📖 Read")).toBeInTheDocument();
    expect(screen.getAllByText("Sam Lee")).toHaveLength(1);
    expect(screen.getByText("🧘 Stretch")).toBeInTheDocument();
  });

  it("drops what you've written about since, the moment you write", () => {
    const run = late({ closedAt: new Date(2026, 10, 7, 9, 0).toISOString() });
    const read = late({ title: "Read", emoji: "📖", closedAt: new Date(2026, 10, 7, 11, 0).toISOString() });
    const { rerender } = render(<EncouragementPrompt habits={[run, read]} lastSentAt={null} />);
    expect(screen.getByText("Morning Run")).toBeInTheDocument();

    // A message sent at 10: Run had closed by then, Read hadn't.
    rerender(
      <EncouragementPrompt habits={[run, read]} lastSentAt={new Date(2026, 10, 7, 10, 0).getTime()} />,
    );
    expect(screen.queryByText("Morning Run")).not.toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();

    rerender(<EncouragementPrompt habits={[run, read]} lastSentAt={NOW.getTime()} />);
    expect(card()).not.toBeInTheDocument();
  });

  it("stays dismissed when the chat is opened again, and lists the habit again on a later day", () => {
    const today = late();
    const { unmount } = render(<EncouragementPrompt habits={[today]} lastSentAt={null} />);

    act(() => screen.getByRole("button", { name: "Dismiss" }).click());
    expect(card()).not.toBeInTheDocument();
    unmount();

    const { unmount: unmountAgain } = render(<EncouragementPrompt habits={[today]} lastSentAt={null} />);
    expect(card()).not.toBeInTheDocument();
    unmountAgain();

    render(
      <EncouragementPrompt
        habits={[{ ...today, kind: "encourage", day: "2026-11-08" }]}
        lastSentAt={null}
      />,
    );
    expect(screen.getByText("Morning Run")).toBeInTheDocument();
  });

  it("folds a long list past four habits, and opens and closes it", () => {
    const titles = ["Run", "Read", "Pray", "Stretch", "Journal", "Walk"];
    render(
      <EncouragementPrompt
        habits={titles.map((title) => late({ title }))}
        lastSentAt={null}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("Journal")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Show 2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    act(() => more.click());
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer).toHaveAttribute("aria-expanded", "true");

    act(() => fewer.click());
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("dismisses the folded ones along with the rest", () => {
    const habits = ["A", "B", "C", "D", "E"].map((n) => late({ ownerId: n, ownerName: n }));
    const { unmount } = render(<EncouragementPrompt habits={habits} showOwners lastSentAt={null} />);

    act(() => screen.getByRole("button", { name: "Dismiss" }).click());
    unmount();

    render(<EncouragementPrompt habits={habits} showOwners lastSentAt={null} />);
    expect(card()).not.toBeInTheDocument();
  });
});
