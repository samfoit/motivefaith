import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "../Skeleton";

describe("Skeleton", () => {
  it("applies shimmer animation by default", () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).style.animation).toContain(
      "motive-shimmer",
    );
  });

  it("disables animation when animate=false", () => {
    const { container } = render(<Skeleton animate={false} />);
    expect((container.firstChild as HTMLElement).style.animation).toBe("none");
  });

  it("is aria-hidden when decorative=true (default)", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has role=status and aria-label when decorative=false", () => {
    const { container } = render(
      <Skeleton decorative={false} ariaLabel="Loading content" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-label", "Loading content");
    expect(el).not.toHaveAttribute("aria-hidden");
  });

  it("circle variant: borderRadius 50%", () => {
    const { container } = render(<Skeleton variant="circle" />);
    expect((container.firstChild as HTMLElement).style.borderRadius).toBe(
      "50%",
    );
  });

  it("text variant: width 100% and borderRadius 4px", () => {
    const { container } = render(<Skeleton variant="text" />);
    const style = (container.firstChild as HTMLElement).style;
    expect(style.width).toBe("100%");
    expect(style.borderRadius).toBe("4px");
  });
});
