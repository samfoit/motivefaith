import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimePickerScope, TimeRangePicker } from "../TimeRangePicker";

/** A range that keeps its own values, as the habit form does. */
function Range({ from = "09:00", until = "12:00" }: { from?: string; until?: string }) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(until);
  return (
    <TimeRangePicker start={start} end={end} onStartChange={setStart} onEndChange={setEnd} />
  );
}

const field = (name: "From" | "Until") =>
  screen.getByRole("button", { name: new RegExp(`^${name},`) });
const picker = (name: "From" | "Until") => screen.getByRole("group", { name: `${name} time` });

describe("TimeRangePicker", () => {
  it("shows each time as the rest of the app writes it", () => {
    render(<Range from="09:00" until="13:30" />);
    expect(field("From")).toHaveAccessibleName("From, 9 AM");
    expect(field("Until")).toHaveAccessibleName("Until, 1:30 PM");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("opens on the field's own time", async () => {
    render(<Range />);
    await userEvent.click(field("From"));

    expect(field("From")).toHaveAttribute("aria-expanded", "true");
    const from = within(picker("From"));
    expect(from.getByRole("radio", { name: "9" })).toBeChecked();
    expect(from.getByRole("radio", { name: ":00" })).toBeChecked();
    expect(from.getByRole("radio", { name: "AM" })).toBeChecked();
  });

  it("sets the time as each part is tapped", async () => {
    render(<Range />);
    await userEvent.click(field("From"));
    await userEvent.click(within(picker("From")).getByRole("radio", { name: "4" }));
    expect(field("From")).toHaveAccessibleName("From, 4 AM");
    await userEvent.click(within(picker("From")).getByRole("radio", { name: ":30" }));
    await userEvent.click(within(picker("From")).getByRole("radio", { name: "PM" }));
    expect(field("From")).toHaveAccessibleName("From, 4:30 PM");
  });

  it("reads 12 as midnight in the morning and noon in the afternoon", async () => {
    render(<Range from="00:30" until="12:00" />);
    expect(field("From")).toHaveAccessibleName("From, 12:30 AM");
    expect(field("Until")).toHaveAccessibleName("Until, 12 PM");

    await userEvent.click(field("From"));
    await userEvent.click(within(picker("From")).getByRole("radio", { name: "PM" }));
    expect(field("From")).toHaveAccessibleName("From, 12:30 PM");
  });

  it("keeps a time off the quarter hour until it is changed", async () => {
    render(<Range from="09:03" />);
    expect(field("From")).toHaveAccessibleName("From, 9:03 AM");

    await userEvent.click(field("From"));
    const minutes = within(within(picker("From")).getByRole("radiogroup", { name: "Minutes" }));
    for (const radio of minutes.getAllByRole("radio")) expect(radio).not.toBeChecked();
    await userEvent.click(minutes.getByRole("radio", { name: ":15" }));
    expect(field("From")).toHaveAccessibleName("From, 9:15 AM");
  });

  it("folds when its field is tapped again, and swaps to the other field", async () => {
    render(<Range />);
    await userEvent.click(field("From"));
    await userEvent.click(field("Until"));
    expect(screen.queryByRole("group", { name: "From time" })).not.toBeInTheDocument();
    expect(picker("Until")).toBeInTheDocument();

    await userEvent.click(field("Until"));
    expect(screen.queryByRole("group", { name: /time$/ })).not.toBeInTheDocument();
    expect(field("Until")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps one picker open among the ranges in a scope", async () => {
    render(
      <TimePickerScope>
        <section aria-label="Usual">
          <Range />
        </section>
        <section aria-label="Weekend">
          <Range from="16:00" until="17:00" />
        </section>
      </TimePickerScope>,
    );
    const usual = within(screen.getByRole("region", { name: "Usual" }));
    const weekend = within(screen.getByRole("region", { name: "Weekend" }));

    await userEvent.click(usual.getByRole("button", { name: /^From,/ }));
    await userEvent.click(weekend.getByRole("button", { name: /^Until,/ }));
    expect(usual.queryByRole("group", { name: "From time" })).not.toBeInTheDocument();
    expect(weekend.getByRole("group", { name: "Until time" })).toBeInTheDocument();
  });

  describe("Escape", () => {
    // Radix dialogs listen on the document as the key goes down; the sheet
    // around the habit form would close on any Escape that reaches it.
    const sheet = vi.fn();
    const onDocument = (e: KeyboardEvent) => e.key === "Escape" && sheet();
    afterEach(() => {
      document.removeEventListener("keydown", onDocument, { capture: true });
      sheet.mockClear();
    });

    it("folds the picker without closing the sheet around it", async () => {
      document.addEventListener("keydown", onDocument, { capture: true });
      render(<Range />);
      await userEvent.click(field("From"));
      within(picker("From")).getByRole("radio", { name: "9" }).focus();

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("group", { name: "From time" })).not.toBeInTheDocument();
      expect(field("From")).toHaveFocus();
      expect(sheet).not.toHaveBeenCalled();
    });

    it("still reaches the sheet with no picker open", async () => {
      document.addEventListener("keydown", onDocument, { capture: true });
      render(<Range />);
      field("From").focus();

      await userEvent.keyboard("{Escape}");

      expect(sheet).toHaveBeenCalledTimes(1);
    });
  });
});
