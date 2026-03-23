import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "../Sheet";

describe("Sheet", () => {
  it("renders content when open=true", () => {
    render(
      <Sheet open title="Test Sheet">
        <p>Sheet content</p>
      </Sheet>,
    );
    expect(screen.getByText("Sheet content")).toBeInTheDocument();
  });

  it("does not render content when open=false", () => {
    render(
      <Sheet open={false} title="Test Sheet">
        <p>Sheet content</p>
      </Sheet>,
    );
    expect(screen.queryByText("Sheet content")).not.toBeInTheDocument();
  });

  it("shows title and description", () => {
    render(
      <Sheet open title="My Title" description="My description">
        Content
      </Sheet>,
    );
    expect(screen.getByText("My Title")).toBeInTheDocument();
    expect(screen.getByText("My description")).toBeInTheDocument();
  });

  it("shows drag handle by default", () => {
    render(
      <Sheet open title="Handle">
        Content
      </Sheet>,
    );
    // The handle is rendered inside Radix Portal, query on document.body
    const handle = document.body.querySelector("[aria-hidden].w-12.rounded-full");
    expect(handle).toBeInTheDocument();
  });

  it("hides drag handle when showHandle=false", () => {
    render(
      <Sheet open showHandle={false} title="No Handle">
        Content
      </Sheet>,
    );
    const handle = document.body.querySelector("[aria-hidden].w-12.rounded-full");
    expect(handle).not.toBeInTheDocument();
  });

  it("close button has correct aria-label", () => {
    render(
      <Sheet open closeLabel="Dismiss" title="Close Test">
        Content
      </Sheet>,
    );
    expect(screen.getByLabelText("Dismiss")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) on close button click", async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={handleOpenChange} closeLabel="Dismiss" title="Close Test">
        Content
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders children", () => {
    render(
      <Sheet open title="Children Test">
        <div data-testid="child">Hello</div>
      </Sheet>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
