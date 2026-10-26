import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditHabitSheet } from "../EditHabitSheet";
import type { Habit } from "@/lib/types/habit";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const sendOrQueue = vi.fn<(entry: unknown, send: () => Promise<unknown>) => Promise<{ queued: boolean }>>(
  async () => ({ queued: false }),
);
vi.mock("@/lib/offline-write", () => ({
  sendOrQueue: (entry: unknown, send: () => Promise<unknown>) => sendOrQueue(entry, send),
}));

// Alice's seed habit: an icon from outside the set, and Mon/Wed/Fri.
const SKETCH = {
  id: "habit-1",
  user_id: "alice",
  title: "Sketch",
  emoji: "✏️",
  description: null,
  frequency: "specific_days",
  schedule: { days: [1, 3, 5] },
  time_window: null,
  color: "#EC4899",
  visibility: "private",
  private_checkins: false,
} as unknown as Habit;

function renderSheet(habit: Habit = SKETCH) {
  const onSaved = vi.fn();
  render(
    <EditHabitSheet
      open
      onOpenChange={vi.fn()}
      habit={habit}
      onSaved={onSaved}
      showToast={vi.fn()}
    />,
  );
  return { onSaved };
}

/** Opens one of a range's fields and picks a time: the hour, then AM or PM. */
async function pickTime(range: HTMLElement, field: "From" | "Until", hour: string, period: "AM" | "PM") {
  await userEvent.click(within(range).getByRole("button", { name: new RegExp(`^${field},`) }));
  const picker = within(range).getByRole("group", { name: `${field} time` });
  await userEvent.click(within(picker).getByRole("radio", { name: hour }));
  await userEvent.click(within(picker).getByRole("radio", { name: period }));
}

/** The time_window the sheet's one save sent. */
function savedWindow() {
  expect(sendOrQueue).toHaveBeenCalledTimes(1);
  const entry = sendOrQueue.mock.calls[0][0] as { payload: { patch: { time_window: unknown } } };
  return entry.payload.patch.time_window;
}

beforeEach(() => {
  sendOrQueue.mockClear();
});

describe("EditHabitSheet", () => {
  it("opens on the habit as it is, in the wizard's own form", () => {
    renderSheet();

    // The name sits in the habit's card, as when it was created.
    expect(screen.getByLabelText("Habit name")).toHaveValue("Sketch");
    expect(
      screen.getByRole("radiogroup", { name: /who can find this habit/i }),
    ).toHaveAccessibleDescription(/nobody can find this/i);
    expect(screen.getByRole("radio", { name: /private/i })).toBeChecked();
    expect(screen.getByRole("button", { name: "✏️" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^repeat/i })).toHaveTextContent("Custom");
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "false");
  });

  it("saves what changed", async () => {
    const { onSaved } = renderSheet();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    const name = screen.getByLabelText("Habit name");
    await userEvent.clear(name);
    await userEvent.type(name, "Sketch daily");
    await userEvent.click(screen.getByRole("button", { name: "🙏" }));
    await userEvent.click(screen.getByRole("button", { name: /^repeat/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^weekdays/i }));
    await userEvent.click(screen.getByRole("switch", { name: /time window/i }));
    await userEvent.click(screen.getByRole("radio", { name: /public/i }));
    await userEvent.click(screen.getByRole("switch", { name: /keep check-in content private/i }));
    await userEvent.click(save);

    expect(sendOrQueue).toHaveBeenCalledTimes(1);
    expect(sendOrQueue.mock.calls[0][0]).toMatchObject({
      kind: "habit.update",
      payload: {
        habitId: "habit-1",
        patch: {
          title: "Sketch daily",
          emoji: "🙏",
          frequency: "weeksdays",
          schedule: { days: [1, 2, 3, 4, 5] },
          time_window: { start: "09:00", end: "12:00" },
          visibility: "public",
          private_checkins: true,
        },
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("EditHabitSheet: a different time on some days", () => {
  // Every day, 8 to 9.
  const RUN = {
    ...SKETCH,
    id: "habit-2",
    title: "Run",
    frequency: "daily",
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
    time_window: { start: "08:00", end: "09:00" },
  } as unknown as Habit;

  // The same, with 4 to 5 at the weekend and any time on Tuesday.
  const RUN_SPLIT = {
    ...RUN,
    time_window: {
      start: "08:00",
      end: "09:00",
      days: {
        "0": { start: "16:00", end: "17:00" },
        "6": { start: "16:00", end: "17:00" },
        "2": null,
      },
    },
  } as unknown as Habit;

  const save = () => screen.getByRole("button", { name: "Save changes" });
  const differentTime = (n: number) => screen.getByRole("group", { name: `Different time ${n}` });

  it("starts the weekend on a time of its own, and saves it", async () => {
    renderSheet(RUN);
    await userEvent.click(screen.getByRole("button", { name: "Different time on some days" }));

    const weekend = differentTime(1);
    expect(within(weekend).getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    expect(within(weekend).getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "true");
    expect(within(weekend).getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "false");
    // The usual time is named for the days it keeps.
    expect(screen.getByRole("group", { name: "Weekdays" })).toBeInTheDocument();
    // It starts on the usual time, so nothing has changed yet.
    expect(save()).toBeDisabled();

    await pickTime(weekend, "From", "4", "PM");
    await pickTime(weekend, "Until", "5", "PM");
    await userEvent.click(save());

    expect(savedWindow()).toEqual({
      start: "08:00",
      end: "09:00",
      days: {
        "0": { start: "16:00", end: "17:00" },
        "6": { start: "16:00", end: "17:00" },
      },
    });
  });

  it("saves a time with no set time as null", async () => {
    renderSheet(RUN);
    await userEvent.click(screen.getByRole("button", { name: "Different time on some days" }));
    await userEvent.click(within(differentTime(1)).getByRole("switch", { name: /set a time/i }));

    expect(within(differentTime(1)).getByText(/any time on these days/i)).toBeInTheDocument();
    expect(within(differentTime(1)).queryByLabelText("From")).not.toBeInTheDocument();
    await userEvent.click(save());

    expect(savedWindow()).toEqual({
      start: "08:00",
      end: "09:00",
      days: { "0": null, "6": null },
    });
  });

  it("opens a habit's different times as they were saved, unchanged", () => {
    renderSheet(RUN_SPLIT);

    const weekend = differentTime(1);
    expect(within(weekend).getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    expect(within(weekend).getByRole("button", { name: "From, 4 PM" })).toBeInTheDocument();

    const tuesday = differentTime(2);
    expect(within(tuesday).getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "true");
    expect(within(tuesday).getByRole("switch", { name: /set a time/i })).not.toBeChecked();

    expect(screen.getByRole("group", { name: "Mon, Wed, Thu, Fri" })).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("moves a day from one time to another when it is picked there", async () => {
    renderSheet(RUN_SPLIT);
    await userEvent.click(
      within(differentTime(2)).getByRole("button", { name: "Saturday, set to another time" }),
    );

    expect(within(differentTime(1)).getByRole("button", { name: "Saturday, set to another time" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(differentTime(2)).getByRole("button", { name: "Saturday" }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(save());

    expect(savedWindow()).toEqual({
      start: "08:00",
      end: "09:00",
      days: { "0": { start: "16:00", end: "17:00" }, "2": null, "6": null },
    });
  });

  it("gives a removed time's days back to the usual time", async () => {
    renderSheet(RUN_SPLIT);
    await userEvent.click(within(differentTime(2)).getByRole("button", { name: "Remove" }));
    await userEvent.click(within(differentTime(1)).getByRole("button", { name: "Remove" }));

    expect(screen.queryByRole("group", { name: /different time/i })).not.toBeInTheDocument();
    await userEvent.click(save());

    expect(savedWindow()).toEqual({ start: "08:00", end: "09:00", days: {} });
  });

  it("keeps a day on the usual time, and only offers the habit's own days", async () => {
    // Monday and Saturday: the weekend one goes, and Monday has to stay.
    renderSheet({ ...RUN, schedule: { days: [1, 6] }, frequency: "specific_days" } as unknown as Habit);
    await userEvent.click(screen.getByRole("button", { name: "Different time on some days" }));

    const saturday = differentTime(1);
    expect(within(saturday).getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
    expect(within(saturday).getByRole("button", { name: "Monday" })).toBeDisabled();
    expect(within(saturday).getByRole("button", { name: "Tuesday" })).toBeDisabled();
    // With one day left on the usual time, there is nothing more to split.
    expect(screen.queryByRole("button", { name: "Another time for other days" })).not.toBeInTheDocument();
  });

  it("keeps a window that runs past midnight unsaved until it is fixed", async () => {
    // Saved before the form refused it: 6 PM to 10 AM.
    renderSheet({ ...RUN, time_window: { start: "18:00", end: "10:00" } } as unknown as Habit);
    expect(screen.getByText(/Until has to be after From/)).toBeInTheDocument();

    const name = screen.getByLabelText("Habit name");
    await userEvent.type(name, " at night");
    expect(save()).toBeDisabled();

    await pickTime(document.body, "Until", "10", "PM");
    expect(screen.queryByText(/Until has to be after From/)).not.toBeInTheDocument();
    await userEvent.click(save());

    expect(savedWindow()).toEqual({ start: "18:00", end: "22:00", days: {} });
  });

  it("offers none of it to a weekly habit", async () => {
    renderSheet(RUN_SPLIT);
    await userEvent.click(screen.getByRole("button", { name: /^repeat/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^weekly/i }));

    expect(screen.queryByRole("group", { name: /different time/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Different time on some days" })).not.toBeInTheDocument();
    await userEvent.click(save());

    expect(savedWindow()).toEqual({ start: "08:00", end: "09:00", days: {} });
  });
});

