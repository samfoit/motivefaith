import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { RepeatPicker } from "../RepeatPicker";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe("RepeatPicker", () => {
  it("names the current choice on its row", () => {
    render(<RepeatPicker frequency="weekends" days={[0, 6]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^repeat/i })).toHaveTextContent("Weekends");
  });

  it("offers every choice in its menu, Custom last", async () => {
    render(<RepeatPicker frequency="daily" days={EVERY_DAY} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^repeat/i }));
    const items = await screen.findAllByRole("menuitemradio");

    expect(items.map((i) => i.textContent)).toEqual([
      "Every day",
      "WeekdaysMonday to Friday",
      "WeekendsSaturday and Sunday",
      "WeeklyOnce a week, any day",
      "CustomChoose the days",
    ]);
  });

  it("a preset brings its own days", async () => {
    const onChange = vi.fn();
    render(<RepeatPicker frequency="daily" days={EVERY_DAY} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /^repeat/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^weekdays/i }));

    expect(onChange).toHaveBeenCalledWith("weeksdays", [1, 2, 3, 4, 5]);
  });

  it("Custom starts from the days the previous choice had", async () => {
    const onChange = vi.fn();
    render(<RepeatPicker frequency="weeksdays" days={[1, 2, 3, 4, 5]} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /^repeat/i }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: /^custom/i }));

    expect(onChange).toHaveBeenCalledWith("specific_days", [1, 2, 3, 4, 5]);
  });

  it("shows the days only for Custom", () => {
    const { rerender } = render(
      <RepeatPicker frequency="daily" days={EVERY_DAY} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Monday" })).not.toBeInTheDocument();

    rerender(<RepeatPicker frequency="specific_days" days={[1, 3, 5]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles a day, keeping the list in week order", async () => {
    const onChange = vi.fn();
    render(<RepeatPicker frequency="specific_days" days={[1, 5]} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    expect(onChange).toHaveBeenLastCalledWith("specific_days", [1, 3, 5]);

    await userEvent.click(screen.getByRole("button", { name: "Monday" }));
    expect(onChange).toHaveBeenLastCalledWith("specific_days", [5]);
  });

  it("says so when no day is left", () => {
    render(<RepeatPicker frequency="specific_days" days={[]} onChange={vi.fn()} />);

    expect(screen.getByText("Choose at least one day.")).toBeInTheDocument();
  });
});
