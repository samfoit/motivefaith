import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationToggle } from "../NotificationToggle";

describe("NotificationToggle", () => {
  it.each([
    [
      "denied-ios",
      "Allow them in Settings > Notifications > MotiveFaith, then close and reopen the app.",
    ],
    [
      "denied-android-app",
      "Allow them in Settings > Apps > MotiveFaith > Notifications, then close and reopen the app.",
    ],
    [
      "denied-android-browser",
      "Tap the icon left of the web address, allow Notifications under Permissions, then reload.",
    ],
  ] as const)("tells %s where its switch is, not just 'browser settings'", (state, help) => {
    render(
      <NotificationToggle
        state={state}
        isLoading={false}
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
      />,
    );
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText(help)).toBeInTheDocument();
    expect(screen.queryByText(/browser settings/)).toBeNull();
    // Nothing in the app can lift the block, so there is nothing to press.
    expect(screen.queryByRole("button")).toBeNull();
  });
});
