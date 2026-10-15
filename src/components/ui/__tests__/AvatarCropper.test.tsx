import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { AvatarCropper } from "../AvatarCropper";

const renderAvatar = vi.fn();
vi.mock("@/lib/utils/avatar-crop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/avatar-crop")>()),
  renderAvatar: (...args: unknown[]) => renderAvatar(...args),
}));

const photo = new File(["x"], "me.jpg", { type: "image/jpeg" });

function loadPhoto(width = 2000, height = 1000) {
  const img = document.querySelector("img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
  fireEvent.load(img);
  return img;
}

describe("AvatarCropper", () => {
  beforeEach(() => {
    renderAvatar.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:photo");
    URL.revokeObjectURL = vi.fn();
    // jsdom lays nothing out: give the stage a width so the frame has a size.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(332);
  });

  it("stays closed with no photo", () => {
    render(<AvatarCropper file={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands back the cropped square on confirm", async () => {
    const square = new Blob(["s"], { type: "image/webp" });
    renderAvatar.mockResolvedValue(square);
    const onConfirm = vi.fn();
    render(<AvatarCropper file={photo} onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Use photo" })).toBeDisabled();
    loadPhoto();
    await userEvent.click(screen.getByRole("button", { name: "Use photo" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(square));
    // The centred square of a 2000×1000 photo.
    expect(renderAvatar.mock.calls[0][1]).toEqual({ x: 500, y: 0, size: 1000 });
  });

  it("zooms with the slider and crops what it shows", async () => {
    renderAvatar.mockResolvedValue(new Blob());
    render(<AvatarCropper file={photo} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    loadPhoto();

    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "Use photo" }));

    await waitFor(() => expect(renderAvatar).toHaveBeenCalled());
    const rect = renderAvatar.mock.calls[0][1];
    expect(rect.size).toBeCloseTo(500);
    expect(rect.x).toBeCloseTo(750);
  });

  it("moves the photo by dragging, but not past its edge", async () => {
    renderAvatar.mockResolvedValue(new Blob());
    render(<AvatarCropper file={photo} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    loadPhoto();

    const crop = screen.getByRole("application");
    fireEvent.pointerDown(crop, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(crop, { pointerId: 1, clientX: 900, clientY: 100 });
    fireEvent.pointerUp(crop, { pointerId: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Use photo" }));

    await waitFor(() => expect(renderAvatar).toHaveBeenCalled());
    // Dragged right as far as it goes: the crop starts at the photo's left edge.
    expect(renderAvatar.mock.calls[0][1].x).toBeCloseTo(0);
  });

  it("cancels", async () => {
    const onCancel = vi.fn();
    render(<AvatarCropper file={photo} onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("says so when the photo cannot be cropped", async () => {
    renderAvatar.mockRejectedValue(new Error("no canvas"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AvatarCropper file={photo} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    loadPhoto();
    await userEvent.click(screen.getByRole("button", { name: "Use photo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t use that photo/i);
  });
});
