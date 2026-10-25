import { render, screen } from "@testing-library/react";
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

function renderSheet() {
  const onSaved = vi.fn();
  render(
    <EditHabitSheet
      open
      onOpenChange={vi.fn()}
      habit={SKETCH}
      onSaved={onSaved}
      showToast={vi.fn()}
    />,
  );
  return { onSaved };
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
