import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { Container } from "../Card";

describe("Container (Card)", () => {
  it("renders children", () => {
    render(<Container>Hello</Container>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("has base classes (rounded-lg, shadow-sm, bg-elevated, p-4)", () => {
    const { container } = render(<Container>Base</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("rounded-lg");
    expect(el.className).toContain("shadow-sm");
    expect(el.className).toContain("bg-elevated");
    expect(el.className).toContain("p-4");
  });

  it("does not have hover classes by default", () => {
    const { container } = render(<Container>No hover</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).not.toContain("hover:-translate-y-1");
  });

  it("adds hover-lift classes when hoverLift=true", () => {
    const { container } = render(<Container hoverLift>Lift</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("hover:-translate-y-1");
    expect(el.className).toContain("hover:shadow-md");
  });

  it("has a hairline border from the tokens", () => {
    const { container } = render(<Container>Border</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-border");
    expect(el.className).not.toContain("habit-tint");
  });

  it("tints with a habit color through .habit-tint", () => {
    const { container } = render(<Container tint="#14B8A6">Tinted</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("habit-tint");
    expect(el.style.getPropertyValue("--habit-color")).toBe("#14B8A6");
  });

  it("keeps a caller's style alongside the tint", () => {
    const { container } = render(
      <Container tint="#14B8A6" style={{ marginTop: 4 }}>
        Styled
      </Container>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.marginTop).toBe("4px");
    expect(el.style.getPropertyValue("--habit-color")).toBe("#14B8A6");
  });

  it("has no tint when tint is null", () => {
    const { container } = render(<Container tint={null}>Plain</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).not.toContain("habit-tint");
    expect(el.style.getPropertyValue("--habit-color")).toBe("");
  });

  it("forwards ref and merges className", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Container ref={ref} className="extra">
        Ref
      </Container>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect((container.firstChild as HTMLElement).className).toContain("extra");
  });
});
