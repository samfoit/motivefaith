"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampOffset,
  clampZoom,
  cropRect,
  displayScale,
  renderAvatar,
  zoomAbout,
  type Point,
  type Size,
} from "@/lib/utils/avatar-crop";

interface AvatarCropperProps {
  /** The photo picked, or null when the cropper is closed. */
  file: File | null;
  /** Called with the cropped square once the user confirms. */
  onConfirm: (blob: Blob) => void | Promise<void>;
  onCancel: () => void;
  title?: string;
}

/** Most the frame grows to on a wide screen, in CSS px. */
const MAX_FRAME_PX = 360;
const KEY_PAN_PX = 12;
const KEY_ZOOM_STEP = 0.1;

type View = { zoom: number; offset: Point };
const START_VIEW: View = { zoom: 1, offset: { x: 0, y: 0 } };

/**
 * Choose which part of a photo becomes a round avatar, the way most apps do:
 * the photo sits behind a circle, and is dragged to move it and pinched (or
 * scrolled, or slid) to zoom. The frame is always covered, so there is no way
 * to end up with an empty edge.
 *
 * Works with touch, mouse and keyboard (arrows move, + and − zoom).
 */
export function AvatarCropper({
  file,
  onConfirm,
  onCancel,
  title = "Move and scale",
}: AvatarCropperProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [image, setImage] = useState<Size | null>(null);
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState<View>(START_VIEW);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // --- The picked photo, as something an <img> can show ---
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    setImage(null);
    setView(START_VIEW);
    setFailed(false);
    setSaving(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // --- The frame's size follows the screen ---
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!stage) return;
    const measure = () =>
      setFrame(Math.max(1, Math.min(MAX_FRAME_PX, stage.clientWidth - 32)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  /** Apply a change to the view, kept inside the photo's bounds. */
  const update = useCallback(
    (next: (v: View) => View) => {
      if (!image || !frame) return;
      setView((v) => {
        const n = next(v);
        const zoom = clampZoom(n.zoom);
        return { zoom, offset: clampOffset(n.offset, image, frame, zoom) };
      });
    },
    [image, frame],
  );

  const zoomTo = useCallback(
    (nextZoom: number, anchor: Point = { x: 0, y: 0 }) => {
      if (!image || !frame) return;
      setView((v) => {
        const zoom = clampZoom(nextZoom);
        return {
          zoom,
          offset: zoomAbout(v.offset, anchor, v.zoom, zoom, image, frame),
        };
      });
    },
    [image, frame],
  );

  // --- Drag to move, pinch to zoom ---
  const pointers = useRef(new Map<number, Point>());
  const frameRef = useRef<HTMLDivElement>(null);

  /** A client point relative to the frame's centre. */
  const fromCentre = (p: Point): Point => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: p.x - (box.left + box.width / 2), y: p.y - (box.top + box.height / 2) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !image || !frame) return;
    const before = [...pointers.current.values()];
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = [...pointers.current.values()];

    if (after.length === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      update((v) => ({ ...v, offset: { x: v.offset.x + dx, y: v.offset.y + dy } }));
      return;
    }

    // Two fingers: zoom by how far apart they moved, about their midpoint,
    // and move with the midpoint too.
    const [a0, b0] = before;
    const [a1, b1] = after;
    const dist0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
    const dist1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
    if (!dist0) return;
    const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    const anchor = fromCentre(mid1);
    const v = viewRef.current;
    const zoom = clampZoom(v.zoom * (dist1 / dist0));
    const panned = {
      x: v.offset.x + (mid1.x - mid0.x),
      y: v.offset.y + (mid1.y - mid0.y),
    };
    update(() => ({
      zoom,
      offset: zoomAbout(panned, anchor, v.zoom, zoom, image, frame),
    }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  // --- Scroll to zoom: a listener of our own, since React's is passive ---
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const anchor = {
        x: e.clientX - (box.left + box.width / 2),
        y: e.clientY - (box.top + box.height / 2),
      };
      zoomTo(viewRef.current.zoom * Math.exp(-e.deltaY / 300), anchor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo, src]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pan: Record<string, Point> = {
      ArrowLeft: { x: KEY_PAN_PX, y: 0 },
      ArrowRight: { x: -KEY_PAN_PX, y: 0 },
      ArrowUp: { x: 0, y: KEY_PAN_PX },
      ArrowDown: { x: 0, y: -KEY_PAN_PX },
    };
    const move = pan[e.key];
    if (move) {
      e.preventDefault();
      update((v) => ({ ...v, offset: { x: v.offset.x + move.x, y: v.offset.y + move.y } }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(viewRef.current.zoom + KEY_ZOOM_STEP);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomTo(viewRef.current.zoom - KEY_ZOOM_STEP);
    }
  };

  const handleConfirm = async () => {
    const el = imgRef.current;
    if (!el || !image || !frame) return;
    setSaving(true);
    try {
      const blob = await renderAvatar(el, cropRect(view.offset, image, frame, view.zoom));
      await onConfirm(blob);
    } catch (err) {
      console.error("Avatar crop failed:", err);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const s = image && frame ? displayScale(image, frame, view.zoom) : 0;

  return (
    <RadixDialog.Root
      open={!!file}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none pt-safe pb-safe"
        >
          <RadixDialog.Title className="shrink-0 pt-5 pb-3 text-center text-base font-semibold">
            {title}
          </RadixDialog.Title>

          <div
            ref={setStage}
            className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden"
          >
            {src && (
              <div
                ref={frameRef}
                role="application"
                aria-label="Photo crop. Drag to move, pinch or scroll to zoom. Arrow keys move, plus and minus zoom."
                tabIndex={0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                className="relative touch-none select-none cursor-grab active:cursor-grabbing rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ width: frame, height: frame }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not something to optimise */}
                <img
                  ref={imgRef}
                  src={src}
                  alt=""
                  draggable={false}
                  onLoad={(e) =>
                    setImage({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    })
                  }
                  onError={() => setFailed(true)}
                  className="absolute max-w-none pointer-events-none"
                  style={
                    image
                      ? {
                          width: image.width * s,
                          height: image.height * s,
                          left: frame / 2 - (image.width * s) / 2 + view.offset.x,
                          top: frame / 2 - (image.height * s) / 2 + view.offset.y,
                        }
                      : { opacity: 0 }
                  }
                />
                {/* The world outside the circle, dimmed: what will be cut away */}
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-full pointer-events-none ring-2 ring-white/80"
                  style={{ boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)" }}
                />
              </div>
            )}
          </div>

          <div className="shrink-0 px-6 pt-4 pb-6 space-y-5">
            {failed && (
              <p role="alert" className="text-center text-sm text-white/80">
                Couldn&rsquo;t use that photo. Try another.
              </p>
            )}
            <div className="mx-auto flex max-w-xs items-center gap-3">
              <button
                type="button"
                onClick={() => zoomTo(view.zoom - 0.25)}
                aria-label="Zoom out"
                className="p-1 text-white/70 hover:text-white"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={view.zoom}
                onChange={(e) => zoomTo(Number(e.target.value))}
                aria-label="Zoom"
                className="flex-1 accent-white"
              />
              <button
                type="button"
                onClick={() => zoomTo(view.zoom + 0.25)}
                aria-label="Zoom in"
                className="p-1 text-white/70 hover:text-white"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
            </div>
            <div className="mx-auto flex max-w-xs gap-3">
              <Button
                variant="ghost"
                className="flex-1 text-white hover:bg-white/10"
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                loading={saving}
                disabled={!image || saving}
              >
                Use photo
              </Button>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
