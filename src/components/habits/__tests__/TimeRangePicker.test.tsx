import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimePickerScope, TimeRangePicker } from "../TimeRangePicker";

/** A range that keeps its own values, as the habit form does. */
function Range({
  from = "09:00",
  until = "12:00",
  overnight,
}: {
  from?: string;
  until?: string;
  overnight?: boolean;
}) {
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(until);
  return (
    <TimeRangePicker
      start={start}
      end={end}
      onChange={(range) => {
        setStart(range.start);
        setEnd(range.end);
      }}
      overnight={overnight}
    />
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
    render(<Range from="00:30" until="12:00" overnight />);
    expect(field("From")).toHaveAccessibleName("From, 12:30 AM");
    expect(field("Until")).toHaveAccessibleName("Until, 12 PM");

    await userEvent.click(field("From"));
    await userEvent.click(within(picker("From")).getByRole("radio", { name: "PM" }));
    expect(field("From")).toHaveAccessibleName("From, 12:30 PM");
  });

  describe("Until after From", () => {
    const notice = /has to be after From\. A window can't run past midnight/;

    it("carries Until along when From moves past it, keeping the window's length", async () => {
      render(<Range from="09:00" until="12:00" />);
      await userEvent.click(field("From"));
      // 1, then PM: on the way through 1 AM nothing moves, and at 1 PM the
      // three hours the window had when From was opened carry Until along.
      await userEvent.click(within(picker("From")).getByRole("radio", { name: "1" }));
      expect(field("Until")).toHaveAccessibleName("Until, 12 PM");
      await userEvent.click(within(picker("From")).getByRole("radio", { name: "PM" }));

      expect(field("From")).toHaveAccessibleName("From, 1 PM");
      expect(field("Until")).toHaveAccessibleName("Until, 4 PM");
      expect(screen.queryByText(notice)).not.toBeInTheDocument();
    });

    it("stops at the end of the day", async () => {
      render(<Range from="21:00" until="23:00" />);
      await userEvent.click(field("From"));
      await userEvent.click(within(picker("From")).getByRole("radio", { name: "11" }));

      expect(field("Until")).toHaveAccessibleName("Until, 11:59 PM");
    });

    it("points out an Until at or before From, and leaves it to be fixed", async () => {
      render(<Range from="18:00" until="22:00" />);
      await userEvent.click(field("Until"));
      await userEvent.click(within(picker("Until")).getByRole("radio", { name: "AM" }));

      expect(field("Until")).toHaveAccessibleName("Until, 10 AM");
      expect(screen.getByText(notice)).toBeInTheDocument();
      expect(field("Until")).toHaveAccessibleDescription(notice);

      await userEvent.click(within(picker("Until")).getByRole("radio", { name: "PM" }));
      expect(screen.queryByText(notice)).not.toBeInTheDocument();
    });

    it("lets a range run overnight when it may, as quiet hours do", async () => {
      render(<Range from="22:00" until="07:00" overnight />);
      expect(screen.queryByText(notice)).not.toBeInTheDocument();

      await userEvent.click(field("From"));
      await userEvent.click(within(picker("From")).getByRole("radio", { name: "11" }));
      expect(field("From")).toHaveAccessibleName("From, 11 PM");
      expect(field("Until")).toHaveAccessibleName("Until, 7 AM");
    });
  });

  describe("an exact minute", () => {
    const minute = () => within(picker("From")).getByRole("textbox", { name: "Minute" });

    it("waits behind a link, and takes any minute: 10:02 PM, for Luke 10:2", async () => {
      render(<Range from="22:00" until="23:00" />);
      await userEvent.click(field("From"));
      expect(within(picker("From")).queryByRole("textbox", { name: "Minute" })).not.toBeInTheDocument();

      await userEvent.click(within(picker("From")).getByRole("button", { name: "Exact minute" }));
      // Focus selects what is there, so typing replaces it.
      await userEvent.type(minute(), "02");

      expect(field("From")).toHaveAccessibleName("From, 10:02 PM");
      const quarters = within(within(picker("From")).getByRole("radiogroup", { name: "Minutes" }));
      for (const radio of quarters.getAllByRole("radio")) expect(radio).not.toBeChecked();
    });

    it("nudges by a minute, wrapping within the hour", async () => {
      render(<Range from="09:00" />);
      await userEvent.click(field("From"));
      await userEvent.click(within(picker("From")).getByRole("button", { name: "Exact minute" }));
      const group = () => within(picker("From")).getByRole("group", { name: "Exact minute" });

      await userEvent.click(within(group()).getByRole("button", { name: "A minute earlier" }));
      expect(field("From")).toHaveAccessibleName("From, 9:59 AM");
      await userEvent.click(within(group()).getByRole("button", { name: "A minute later" }));
      await userEvent.click(within(group()).getByRole("button", { name: "A minute later" }));
      expect(field("From")).toHaveAccessibleName("From, 9:01 AM");

      // The arrow keys nudge too.
      await userEvent.click(minute());
      await userEvent.keyboard("{ArrowUp}{ArrowUp}");
      expect(field("From")).toHaveAccessibleName("From, 9:03 AM");
    });

    it("refuses a minute past 59", async () => {
      render(<Range from="09:00" />);
      await userEvent.click(field("From"));
      await userEvent.click(within(picker("From")).getByRole("button", { name: "Exact minute" }));
      await userEvent.type(minute(), "60");

      expect(field("From")).toHaveAccessibleName("From, 9:06 AM");
    });

    it("opens by itself for a time saved off the quarter, until a quarter is picked", async () => {
      render(<Range from="22:02" until="23:00" />);
      await userEvent.click(field("From"));
      expect(minute()).toHaveValue("02");
      expect(within(picker("From")).getByRole("radio", { name: "PM" })).toBeChecked();

      await userEvent.click(within(picker("From")).getByRole("radio", { name: ":15" }));
      expect(field("From")).toHaveAccessibleName("From, 10:15 PM");
      expect(within(picker("From")).queryByRole("textbox", { name: "Minute" })).not.toBeInTheDocument();
      expect(within(picker("From")).getByRole("button", { name: "Exact minute" })).toBeInTheDocument();
    });

    it("stays open when a nudge lands on a quarter", async () => {
      render(<Range from="09:14" />);
      await userEvent.click(field("From"));
      await userEvent.click(
        within(within(picker("From")).getByRole("group", { name: "Exact minute" })).getByRole("button", {
          name: "A minute later",
        }),
      );
      expect(field("From")).toHaveAccessibleName("From, 9:15 AM");
      expect(minute()).toHaveValue("15");
    });
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
