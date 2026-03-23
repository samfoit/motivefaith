import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { TextArea } from "../TextArea";

describe("TextArea", () => {
  it("renders a textarea element", () => {
    render(<TextArea />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("defaults to 4 rows", () => {
    render(<TextArea />);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "4");
  });

  it("accepts custom rows", () => {
    render(<TextArea rows={8} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "8");
  });

  it("renders label", () => {
    render(<TextArea label="Notes" />);
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("renders helper text", () => {
    render(<TextArea helper="Optional notes" />);
    expect(screen.getByText("Optional notes")).toBeInTheDocument();
  });

  it("shows error and sets aria-invalid", () => {
    render(<TextArea error="Required" />);
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<TextArea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("supports disabled state", () => {
    render(<TextArea disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
