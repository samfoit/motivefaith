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

  it("applies preset accent class for 'health'", () => {
    const { container } = render(
      <Container colorAccent="health">Health</Container>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-emerald-400");
    expect(el.className).toContain("border-l-[3px]");
  });

  it("applies preset accent class for 'productivity'", () => {
    const { container } = render(
      <Container colorAccent="productivity">Prod</Container>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-indigo-400");
  });

  it("applies custom string as accent class when not a preset key", () => {
    const { container } = render(
      <Container colorAccent="border-red-500">Custom</Container>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-red-500");
    expect(el.className).toContain("border-l-[3px]");
  });

  it("has no accent when colorAccent is null", () => {
    const { container } = render(<Container>No accent</Container>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).not.toContain("border-l-[3px]");
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
