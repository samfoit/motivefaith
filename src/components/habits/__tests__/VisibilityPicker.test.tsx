import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { VisibilityPicker } from "../VisibilityPicker";

describe("VisibilityPicker", () => {
  it("marks the current value as the selected radio", () => {
    render(<VisibilityPicker value="private" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Public/ })).not.toBeChecked();
  });

  it("reports the other option when it is chosen", async () => {
    const onChange = vi.fn();
    render(<VisibilityPicker value="private" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: /Public/ }));

    expect(onChange).toHaveBeenCalledWith("public");
  });

  it("does not promise that public means followed", () => {
    // The distinction the whole feature rests on: public is about being
    // findable, not about who sees the streak. If this copy drifts back into
    // "everyone can see your progress", the setting is lying.
    render(<VisibilityPicker value="public" onChange={vi.fn()} />);

    expect(
      screen.getByText(/ask to follow it/i),
    ).toBeInTheDocument();
  });
});
