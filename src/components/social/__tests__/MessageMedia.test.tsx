import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MessageMedia } from "../MessageMedia";

vi.mock("@/lib/utils/evidence", () => ({
  resolveEvidenceUrl: async (path: string) => `https://storage.test/${path}`,
}));

describe("MessageMedia", () => {
  it("opens a sent photo full size, and closes it again", async () => {
    render(<MessageMedia path="me/capture/a.webp" type="photo" />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "View photo" }));

    // The full-size copy lives in the portalled dialog, not in the bubble.
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("img")).not.toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("loads a GIF as it is, so it keeps moving", async () => {
    const { container } = render(<MessageMedia path="me/capture/c.gif" type="photo" />);

    // Straight from storage: the optimizer would re-encode it as a still.
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("data-unoptimized"),
    );
  });

  // The optimizer's cache would keep a copy of a private photo past its
  // signed link's hour (059). Photos are shrunk to WebP before upload anyway.
  it("loads an ordinary photo straight from storage too", async () => {
    const { container } = render(<MessageMedia path="me/capture/a.webp" type="photo" />);

    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute("data-unoptimized"),
    );
  });

  it("closes on Escape", async () => {
    render(<MessageMedia path="me/capture/a.webp" type="photo" />);
    await userEvent.click(screen.getByRole("button", { name: "View photo" }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("plays a video in place rather than opening it", async () => {
    const { container } = render(<MessageMedia path="me/capture/b.mp4" type="video" />);
    expect(screen.queryByRole("button", { name: "View photo" })).toBeNull();

    // Once its link resolves, the player is right there, with its own controls.
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute(
        "src",
        "https://storage.test/me/capture/b.mp4",
      ),
    );
    expect(container.querySelector("video")).toHaveAttribute("controls");
  });
});
