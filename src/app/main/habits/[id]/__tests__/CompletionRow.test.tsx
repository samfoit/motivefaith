import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { CompletionRow } from "../habit-detail-client";

vi.mock("@/lib/utils/evidence", () => ({
  resolveEvidenceUrl: async (path: string) => `https://storage.test/${path}`,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const base = {
  id: "c1",
  habit_id: "h1",
  evidence_url: null,
  notes: null,
  completed_at: new Date().toISOString(),
};

describe("CompletionRow", () => {
  it("opens a photo full size", async () => {
    render(
      <CompletionRow
        completion={{ ...base, completion_type: "photo", evidence_url: "me/h1/a.webp" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "View photo full size" }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("img")).not.toBeNull());
  });

  it("shows the caption written with a photo, video or voice note", () => {
    for (const type of ["photo", "video", "voice"] as const) {
      const { unmount } = render(
        <CompletionRow
          completion={{
            ...base,
            completion_type: type,
            evidence_url: "me/h1/a",
            notes: `${type} caption`,
          }}
        />,
      );
      expect(screen.getByText(new RegExp(`${type} caption`))).toBeInTheDocument();
      unmount();
    }
  });

  it("offers the rest of a long message only when it is cut off", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);

    render(
      <CompletionRow
        completion={{ ...base, completion_type: "message", notes: "a long message" }}
      />,
    );
    const toggle = await screen.findByRole("button", { name: "Show more" });
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    vi.restoreAllMocks();
  });

  it("offers no toggle for a message that fits", () => {
    render(
      <CompletionRow
        completion={{ ...base, completion_type: "message", notes: "short" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
