import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { IconPicker } from "../IconPicker";

const toggle = () => screen.getByRole("button", { name: /show (all|less)/i });
/** The icons, in order: every button that can be pressed. */
const icons = () =>
  screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));

describe("IconPicker", () => {
  it("marks the current icon as the pressed one", () => {
    render(<IconPicker value="📚" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "📚" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "✅" })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts folded to one row, and Show all opens the whole set", async () => {
    render(<IconPicker value="✅" onChange={vi.fn()} />);

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveTextContent("Show less");
  });

  it("folds the set back up once an icon is picked from it, like a menu", async () => {
    const onChange = vi.fn();
    render(<IconPicker value="✅" onChange={onChange} />);

    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole("button", { name: "🐕" }));

    expect(onChange).toHaveBeenCalledWith("🐕");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("picking from the folded row just picks", async () => {
    const onChange = vi.fn();
    render(<IconPicker value="✅" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "🏃" }));

    expect(onChange).toHaveBeenCalledWith("🏃");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a habit's icon from outside the set, first, even after another pick", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<IconPicker value="✏️" onChange={onChange} />);

    expect(icons()[0]).toHaveTextContent("✏️");
    expect(icons()[0]).toHaveAttribute("aria-pressed", "true");

    rerender(<IconPicker value="🏃" onChange={onChange} />);
    expect(icons()[0]).toHaveTextContent("✏️");
    expect(icons()[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("puts prayer and the cross in the first row, after the default", () => {
    render(<IconPicker value="✅" onChange={vi.fn()} />);

    expect(icons().slice(0, 3).map((b) => b.textContent)).toEqual(["✅", "🙏", "✝️"]);
  });
});
