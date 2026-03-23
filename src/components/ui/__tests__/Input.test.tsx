import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { Input } from "../Input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders a label", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("associates label via htmlFor", () => {
    render(<Input label="Email" id="email-field" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email-field");
  });

  it("renders helper text", () => {
    render(<Input helper="Enter your email" />);
    expect(screen.getByText("Enter your email")).toBeInTheDocument();
  });

  it("links helper text via aria-describedby", () => {
    render(<Input helper="Help text" id="test-input" />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-describedby", "test-input-help");
    expect(document.getElementById("test-input-help")?.textContent).toBe(
      "Help text",
    );
  });

  it("shows error message and sets aria-invalid when error is a string", () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText("This field is required")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("sets aria-invalid without message when error is boolean true", () => {
    render(<Input error={true} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("error string replaces helper text display", () => {
    render(<Input helper="Help" error="Error!" />);
    expect(screen.getByText("Error!")).toBeInTheDocument();
    expect(screen.queryByText("Help")).not.toBeInTheDocument();
  });

  it("forwards ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("sets disabled attribute", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("merges custom className", () => {
    render(<Input className="my-input" />);
    expect(screen.getByRole("textbox").className).toContain("my-input");
  });

  it("does not render helper when neither helper nor error string provided", () => {
    const { container } = render(<Input />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("does not set aria-describedby when no helper or error string", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-describedby");
  });
});
