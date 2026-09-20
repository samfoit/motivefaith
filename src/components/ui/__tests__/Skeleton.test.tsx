import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonScreen } from "../Skeleton";

/**
 * The shimmer, radii and reveal timing now live in `.motive-skeleton*` classes
 * in globals.css rather than in inline styles, so that every skeleton in the
 * app shares one definition and one `prefers-reduced-motion` opt-out. These
 * tests assert the class contract; the visual values themselves are CSS.
 */
describe("Skeleton", () => {
  it("applies the shared skeleton class (shimmer) by default", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass("motive-skeleton");
    expect(container.firstChild).not.toHaveClass("motive-skeleton--static");
  });

  it("disables animation when animate=false", () => {
    const { container } = render(<Skeleton animate={false} />);
    expect(container.firstChild).toHaveClass("motive-skeleton--static");
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

  it("circle variant uses the circle modifier", () => {
    const { container } = render(<Skeleton variant="circle" />);
    expect(container.firstChild).toHaveClass("motive-skeleton--circle");
  });

  it("text variant uses the text modifier and fills the width", () => {
    const { container } = render(<Skeleton variant="text" />);
    expect(container.firstChild).toHaveClass("motive-skeleton--text");
    expect((container.firstChild as HTMLElement).style.width).toBe("100%");
  });

  it("explicit width/height still win over the variant defaults", () => {
    const { container } = render(
      <Skeleton variant="text" width={120} height={16} />,
    );
    const style = (container.firstChild as HTMLElement).style;
    expect(style.width).toBe("120px");
    expect(style.height).toBe("16px");
  });
});

describe("SkeletonScreen", () => {
  it("carries the delayed-reveal class so quick loads never paint a skeleton", () => {
    const { container } = render(
      <SkeletonScreen>
        <Skeleton />
      </SkeletonScreen>,
    );
    expect(container.firstChild).toHaveClass("motive-skeleton-screen");
  });

  it("announces the loading screen once, not once per block", () => {
    render(
      <SkeletonScreen label="Loading your habits">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </SkeletonScreen>,
    );
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAttribute("aria-busy", "true");
    expect(statuses[0]).toHaveAttribute("aria-live", "polite");
    expect(statuses[0]).toHaveTextContent("Loading your habits");
  });

  it("keeps the individual blocks hidden from assistive tech", () => {
    const { container } = render(
      <SkeletonScreen>
        <Skeleton />
      </SkeletonScreen>,
    );
    const blocks = container.querySelectorAll(".motive-skeleton");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveAttribute("aria-hidden", "true");
  });
});
