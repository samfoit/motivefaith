import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StrictMode, useRef } from "react";
import { render, fireEvent } from "@testing-library/react";
import { useKeyboardOffset } from "../useKeyboardOffset";

const REST = "calc(4rem + env(safe-area-inset-bottom))";

/**
 * jsdom has no visualViewport. This stands in for the one a phone reports:
 * with the keyboard open it is shorter than the layout viewport.
 */
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

let vv: FakeVisualViewport;

beforeEach(() => {
  vv = new FakeVisualViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

afterEach(() => {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
});

function Composer() {
  const ref = useRef<HTMLDivElement>(null);
  useKeyboardOffset(ref, REST);
  return (
    <div ref={ref} data-testid="bar" style={{ position: "fixed", bottom: REST }}>
      <input aria-label="Message" />
      <button type="submit">Send</button>
    </div>
  );
}

function openKeyboard(height: number) {
  vv.height = 800 - height;
  vv.dispatchEvent(new Event("resize"));
}

describe("useKeyboardOffset", () => {
  it("keeps the bar pinned above the nav after a strict-mode remount", () => {
    // Dev mounts, cleans up and mounts again. The cleanup clears the inline
    // bottom; without a reposition on mount the bar floated mid-screen.
    const { getByTestId } = render(
      <StrictMode>
        <Composer />
      </StrictMode>,
    );
    expect(getByTestId("bar").style.bottom).toBe(REST);
  });

  it("does not move the bar during the tap that opens the keyboard", () => {
    // iOS cancels the focus, and drops the keyboard, if the bar moves under
    // the finger. Only the viewport resize that follows may move it.
    const { getByTestId, getByLabelText } = render(<Composer />);
    fireEvent.focusIn(getByLabelText("Message"));
    expect(getByTestId("bar").style.bottom).toBe(REST);
  });

  it("rides up with the keyboard and over the nav", () => {
    const { getByTestId, getByLabelText } = render(<Composer />);
    fireEvent.focusIn(getByLabelText("Message"));
    openKeyboard(320);
    expect(getByTestId("bar").style.bottom).toBe("320px");
    expect(getByTestId("bar").style.zIndex).toBe("50");
  });

  it("follows the keyboard as the page scrolls under it", () => {
    const { getByTestId, getByLabelText } = render(<Composer />);
    fireEvent.focusIn(getByLabelText("Message"));
    openKeyboard(320);
    vv.offsetTop = 40;
    vv.dispatchEvent(new Event("scroll"));
    expect(getByTestId("bar").style.bottom).toBe("280px");
  });

  it("stays up while focus moves to the send button", () => {
    const { getByTestId, getByLabelText, getByRole } = render(<Composer />);
    fireEvent.focusIn(getByLabelText("Message"));
    openKeyboard(320);
    fireEvent.focusOut(getByLabelText("Message"), { relatedTarget: getByRole("button") });
    expect(getByTestId("bar").style.bottom).toBe("320px");
  });

  it("settles back above the nav when the keyboard closes", () => {
    const { getByTestId, getByLabelText } = render(<Composer />);
    fireEvent.focusIn(getByLabelText("Message"));
    openKeyboard(320);
    fireEvent.focusOut(getByLabelText("Message"));
    expect(getByTestId("bar").style.bottom).toBe(REST);
    expect(getByTestId("bar").style.zIndex).toBe("");
  });
});
