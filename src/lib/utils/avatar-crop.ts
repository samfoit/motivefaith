/**
 * The geometry behind the avatar cropper, kept apart from the component so it
 * can be tested without a DOM.
 *
 * The cropper shows a square frame (`frame` CSS px across) with the photo
 * behind it. At zoom 1 the photo exactly covers the frame along its shorter
 * side, the way `object-fit: cover` would. `offset` is how far the photo's
 * centre sits from the frame's centre, in CSS px. The photo may never be moved
 * or shrunk so far that the frame shows past its edge.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** The square avatar written to storage, in px. */
export const AVATAR_OUTPUT_PX = 512;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** CSS px per photo pixel at a given zoom. */
export function displayScale(image: Size, frame: number, zoom: number): number {
  return (frame / Math.min(image.width, image.height)) * zoom;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Keep the photo covering the frame: no gap may show along any edge. */
export function clampOffset(
  offset: Point,
  image: Size,
  frame: number,
  zoom: number,
): Point {
  const s = displayScale(image, frame, zoom);
  const maxX = Math.max(0, (image.width * s - frame) / 2);
  const maxY = Math.max(0, (image.height * s - frame) / 2);
  // `|| 0` folds the -0 that clamping to a zero range can produce.
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, offset.y)) || 0,
  };
}

/**
 * The offset after zooming from `zoom` to `nextZoom` about `anchor` (a point
 * relative to the frame's centre, in CSS px), so whatever is under the
 * fingers or the pointer stays there. Clamped.
 */
export function zoomAbout(
  offset: Point,
  anchor: Point,
  zoom: number,
  nextZoom: number,
  image: Size,
  frame: number,
): Point {
  const ratio = nextZoom / zoom;
  return clampOffset(
    {
      x: anchor.x - (anchor.x - offset.x) * ratio,
      y: anchor.y - (anchor.y - offset.y) * ratio,
    },
    image,
    frame,
    nextZoom,
  );
}

/** The square of the photo, in its own pixels, that the frame shows. */
export function cropRect(
  offset: Point,
  image: Size,
  frame: number,
  zoom: number,
): { x: number; y: number; size: number } {
  const s = displayScale(image, frame, zoom);
  const size = frame / s;
  return {
    x: image.width / 2 - (frame / 2 + offset.x) / s,
    y: image.height / 2 - (frame / 2 + offset.y) / s,
    size,
  };
}

/**
 * Draw the chosen square out of the photo as the avatar file. WebP where the
 * browser can encode it; older Safari hands back PNG instead, and the blob's
 * own type says which.
 */
export function renderAvatar(
  image: CanvasImageSource,
  rect: { x: number; y: number; size: number },
  outputPx = AVATAR_OUTPUT_PX,
): Promise<Blob> {
  // Never upscale a small photo past its own pixels.
  const px = Math.max(1, Math.min(outputPx, Math.round(rect.size)));
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas not supported"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, px, px);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not crop photo"))),
      "image/webp",
      0.9,
    );
  });
}
