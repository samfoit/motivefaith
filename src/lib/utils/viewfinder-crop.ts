/**
 * The part of a camera frame the viewfinder actually shows.
 *
 * The viewfinder draws the camera with `object-fit: cover`, so whenever the
 * screen's shape differs from the sensor's — a 4:3 webcam on a wide monitor,
 * a 4:3 phone sensor in a tall portrait screen — it trims the overflow off
 * two edges. A capture must trim the same overflow, or it records more than
 * was on screen. A digital zoom then crops further, around the centre.
 *
 * Returns the source rectangle to draw, in camera pixels, so the output keeps
 * the camera's own resolution for that region rather than being upscaled.
 */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function viewfinderCrop(
  frameWidth: number,
  frameHeight: number,
  /** The viewfinder's width / height on screen. Non-finite or ≤ 0: no trim. */
  viewAspect: number,
  /** Digital zoom factor, ≥ 1. */
  zoom = 1,
): CropRect {
  let sw = frameWidth;
  let sh = frameHeight;

  if (Number.isFinite(viewAspect) && viewAspect > 0) {
    if (frameWidth / frameHeight > viewAspect) sw = frameHeight * viewAspect;
    else sh = frameWidth / viewAspect;
  }

  const z = Math.max(1, zoom);
  sw /= z;
  sh /= z;

  return {
    sx: (frameWidth - sw) / 2,
    sy: (frameHeight - sh) / 2,
    sw,
    sh,
  };
}

/** width / height of an element as laid out, or NaN before layout. */
export function elementAspect(el: HTMLElement): number {
  const { clientWidth: w, clientHeight: h } = el;
  return w > 0 && h > 0 ? w / h : NaN;
}
