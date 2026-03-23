import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "../Badge";

describe("Pill (Badge)", () => {
  it("renders children", () => {
    render(<Pill>Active</Pill>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("has role=status and aria-live=polite", () => {
    render(<Pill>Status</Pill>);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  // Variant classes
  it("applies default variant classes", () => {
    render(<Pill>Default</Pill>);
    expect(screen.getByRole("status").className).toContain("bg-gray-100");
  });

  it("applies health variant classes", () => {
    render(<Pill variant="health">Health</Pill>);
    expect(screen.getByRole("status").className).toContain("bg-emerald-100");
  });

  it("applies learning variant classes", () => {
    render(<Pill variant="learning">Learning</Pill>);
    expect(screen.getByRole("status").className).toContain("bg-amber-100");
  });

  // Outline mode
  it("applies ring-based classes in outline mode", () => {
    render(<Pill outline>Outline</Pill>);
    const className = screen.getByRole("status").className;
    expect(className).toContain("ring-1");
    expect(className).toContain("bg-transparent");
  });

  it("applies outline variant-specific classes", () => {
    render(
      <Pill outline variant="health">
        Outline Health
      </Pill>,
    );
    expect(screen.getByRole("status").className).toContain("ring-emerald-100");
  });

  // Status dot
  it("shows status dot when showStatusDot=true and status is set", () => {
    const { container } = render(
      <Pill showStatusDot status="positive">
        Good
      </Pill>,
    );
    const dot = container.querySelector(".bg-emerald-500");
    expect(dot).toBeInTheDocument();
  });

  it("does not show status dot when showStatusDot=false", () => {
    const { container } = render(<Pill status="positive">No dot</Pill>);
    const dot = container.querySelector(".bg-emerald-500");
    expect(dot).toBeNull();
  });

  it("shows correct dot color per status", () => {
    const { container: c1 } = render(
      <Pill showStatusDot status="negative">
        Neg
      </Pill>,
    );
    expect(c1.querySelector(".bg-rose-500")).toBeInTheDocument();

    const { container: c2 } = render(
      <Pill showStatusDot status="warning">
        Warn
      </Pill>,
    );
    expect(c2.querySelector(".bg-amber-500")).toBeInTheDocument();
  });

  // Count badge
  it("renders count when number is provided", () => {
    render(<Pill count={5}>Items</Pill>);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("count has aria-label with count", () => {
    render(<Pill count={3}>Items</Pill>);
    expect(screen.getByLabelText("count 3")).toBeInTheDocument();
  });

  it("does not render count when null", () => {
    render(<Pill count={null}>Items</Pill>);
    expect(screen.queryByLabelText(/count/)).toBeNull();
  });

  // Size
  it("applies sm size classes", () => {
    render(<Pill size="sm">Small</Pill>);
    expect(screen.getByRole("status").className).toContain("text-xs");
    expect(screen.getByRole("status").className).toContain("px-2");
  });

  it("applies md size classes by default", () => {
    render(<Pill>Medium</Pill>);
    expect(screen.getByRole("status").className).toContain("text-sm");
    expect(screen.getByRole("status").className).toContain("px-3");
  });
});
