import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ChallengeEvent } from "../ChallengeEvent";

describe("ChallengeEvent", () => {
  it("offers Join on a challenge someone started", async () => {
    const onJoin = vi.fn();
    render(
      <ChallengeEvent
        kind="started"
        actorName="Alice"
        actorAvatar={null}
        isMe={false}
        challengeEmoji="🌅"
        challengeTitle="7-Day Early Bird"
        onJoin={onJoin}
      />,
    );
    expect(screen.getByText(/started/)).toHaveTextContent("Alice started 🌅 7-Day Early Bird");
    await userEvent.click(screen.getByRole("button", { name: "Join challenge" }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it("is just the line when there's nothing to join", () => {
    render(
      <ChallengeEvent
        kind="joined"
        actorName="You"
        actorAvatar={null}
        isMe
        challengeEmoji={null}
        challengeTitle="Fast"
      />,
    );
    expect(screen.getByText(/joined/)).toHaveTextContent("You joined 🎯 Fast");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
