import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceMedia } from "../EvidenceMedia";
import { EvidenceAudio } from "../EvidenceAudio";

const resolveEvidenceUrl = vi.fn<(path: string) => Promise<string | null>>();

vi.mock("@/lib/utils/evidence", () => ({
  resolveEvidenceUrl: (path: string) => resolveEvidenceUrl(path),
}));

beforeEach(() => {
  resolveEvidenceUrl.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EvidenceMedia", () => {
  it("says a photo is no longer available when Storage has nothing for it", async () => {
    resolveEvidenceUrl.mockResolvedValue(null);
    render(<EvidenceMedia path="u/h/gone.webp" type="photo" />);

    expect(await screen.findByText("Photo no longer available")).toBeInTheDocument();
  });

  it("says a video is no longer available the same way", async () => {
    resolveEvidenceUrl.mockResolvedValue(null);
    render(<EvidenceMedia path="u/h/gone.mp4" type="video" />);

    expect(await screen.findByText("Video no longer available")).toBeInTheDocument();
  });

  it("tells a failed request apart, and tries again once back online", async () => {
    resolveEvidenceUrl.mockRejectedValueOnce(new Error("offline"));
    const { container } = render(<EvidenceMedia path="u/h/a.mp4" type="video" />);

    expect(await screen.findByText("Can't load right now")).toBeInTheDocument();
    expect(screen.queryByText(/no longer available/)).toBeNull();

    resolveEvidenceUrl.mockResolvedValueOnce("https://storage.test/u/h/a.mp4");
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://storage.test/u/h/a.mp4",
    );
    expect(resolveEvidenceUrl).toHaveBeenCalledTimes(2);
  });

  it("calls an expired legacy link gone once the image will not load", async () => {
    const { container } = render(
      <EvidenceMedia path="http://localhost/storage/v1/object/sign/old.jpg" type="photo" />,
    );

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(await screen.findByText("Photo no longer available")).toBeInTheDocument();
    expect(resolveEvidenceUrl).not.toHaveBeenCalled();
  });
});

describe("EvidenceAudio", () => {
  it("says a voice note is no longer available", async () => {
    resolveEvidenceUrl.mockResolvedValue(null);
    render(<EvidenceAudio path="u/h/gone.webm" />);

    expect(await screen.findByText("Voice note no longer available")).toBeInTheDocument();
  });
});
