"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CameraState = "unsupported" | "prompt" | "granted" | "denied";

/** The zoom factors the active camera accepts. `min` is always "no zoom". */
export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

/**
 * The slice of a video track that deals in zoom. `zoom` is not in the standard
 * `MediaTrackCapabilities`, and `getCapabilities` itself is missing on older
 * Safari, so both are typed as optional here rather than asserted.
 */
interface ZoomCapableTrack {
  getCapabilities?: () => MediaTrackCapabilities & { zoom?: ZoomRange };
}

export interface UseCameraOptions {
  /** Request audio alongside video (needed for video recording). */
  audio?: boolean;
}

export interface UseCameraReturn {
  state: CameraState;
  stream: MediaStream | null;
  /** Current facing mode of the active camera. */
  facingMode: "user" | "environment";
  /** Error message to display to the user (e.g. "No camera found"). */
  errorMessage: string | null;
  /** Current zoom factor. Equal to `zoomRange.min` when not zoomed. */
  zoom: number;
  /** Accepted zoom factors for the active camera. */
  zoomRange: ZoomRange;
  /**
   * True when the camera itself is zooming. False means the range is ours and
   * the caller has to crop — see `CameraCapture`, which does it on a canvas so
   * the saved photo or video matches the viewfinder.
   */
  isOpticalZoom: boolean;
  requestCamera: (facingMode?: "user" | "environment") => Promise<void>;
  /**
   * Flip between front and back. `keepAudio` swaps only the video source and
   * leaves the audio track running, for a caller that is midway through
   * recording it — see `CameraCapture`.
   */
  switchCamera: (options?: { keepAudio?: boolean }) => Promise<void>;
  setZoom: (value: number) => void;
  stopCamera: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * How far we will zoom when the hardware will not do it for us. Digital zoom
 * is a crop, so every factor costs resolution; 4x is about as far as a phone
 * sensor stretches before the result stops being worth keeping.
 */
const DIGITAL_ZOOM_RANGE: ZoomRange = { min: 1, max: 4, step: 0.1 };

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stop every track on a MediaStream. */
function killStream(s: MediaStream | null) {
  if (s) s.getTracks().forEach((t) => t.stop());
}

/** Clamp `value` into a zoom range, snapping nothing — the UI is continuous. */
function clampZoom(value: number, range: ZoomRange): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Read the zoom range a track supports. Chrome on Android reports one; Safari
 * and every desktop browser report nothing, and those fall back to our own
 * digital range.
 */
function readZoomRange(track: MediaStreamTrack | undefined): ZoomRange | null {
  const capable = track as unknown as ZoomCapableTrack | undefined;
  if (!capable || typeof capable.getCapabilities !== "function") return null;

  let zoom: ZoomRange | undefined;
  try {
    zoom = capable.getCapabilities().zoom;
  } catch {
    return null;
  }

  if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max)) return null;
  if (zoom.max <= zoom.min) return null;

  return { min: zoom.min, max: zoom.max, step: zoom.step || 0.1 };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCamera(options: UseCameraOptions = {}): UseCameraReturn {
  const { audio = false } = options;

  const [state, setState] = useState<CameraState>(() =>
    isCameraSupported() ? "prompt" : "unsupported",
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [zoomRange, setZoomRange] = useState<ZoomRange>(DIGITAL_ZOOM_RANGE);
  const [isOpticalZoom, setIsOpticalZoom] = useState(false);
  const [zoom, setZoomValue] = useState(DIGITAL_ZOOM_RANGE.min);

  // Ref always mirrors the latest stream so cleanup can access it
  // without depending on React state lifecycle.
  const streamRef = useRef<MediaStream | null>(null);

  // Track current facing mode so switchCamera can toggle it.
  const facingModeRef = useRef<"user" | "environment">("environment");

  // Zoom is driven by a gesture, so it has to be readable and writable outside
  // the render cycle — the range comes from whichever camera is now live.
  const zoomRangeRef = useRef<ZoomRange>(DIGITAL_ZOOM_RANGE);
  const isOpticalZoomRef = useRef(false);

  // One flip at a time; a double tap landing twice must not leave two
  // getUserMedia calls racing to own the stream.
  const switchingRef = useRef(false);

  // --- Adopt the zoom range of whichever camera just became live ---
  const adoptZoomRange = useCallback((s: MediaStream) => {
    const optical = readZoomRange(s.getVideoTracks()[0]);
    const range = optical ?? DIGITAL_ZOOM_RANGE;

    zoomRangeRef.current = range;
    isOpticalZoomRef.current = optical !== null;
    setZoomRange(range);
    setIsOpticalZoom(optical !== null);
    setZoomValue(range.min);
  }, []);

  // --- Stop all tracks and clean up ---
  const stopCamera = useCallback(() => {
    killStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  // --- Request camera access ---
  const requestCamera = useCallback(
    async (facingMode: "user" | "environment" = "environment") => {
      if (!isCameraSupported()) {
        setState("unsupported");
        return;
      }

      facingModeRef.current = facingMode;
      setFacingMode(facingMode);
      setErrorMessage(null);

      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio,
        });

        // Stop any previously active stream before replacing.
        killStream(streamRef.current);
        streamRef.current = newStream;
        setStream(newStream);
        setState("granted");

        // Each camera has its own zoom range, so re-read it and start wide.
        adoptZoomRange(newStream);
      } catch (err) {
        const error = err as DOMException;

        if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
          setState("denied");
          setErrorMessage("Camera access was denied. Please enable it in your browser settings.");
        } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
          setState("unsupported");
          setErrorMessage("No camera found on this device.");
        } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
          setErrorMessage("Camera is already in use by another app.");
        } else {
          setErrorMessage("Could not access camera. Please try again.");
        }

        console.error("getUserMedia error:", error.name, error.message);
      }
    },
    [audio, adoptZoomRange],
  );

  // --- Zoom ---
  const setZoom = useCallback((value: number) => {
    const range = zoomRangeRef.current;
    const next = clampZoom(value, range);
    setZoomValue(next);

    if (!isOpticalZoomRef.current) return;

    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    // `zoom` is a non-standard constraint, so it travels in `advanced` where a
    // browser that does not know it will ignore it rather than reject the set.
    track
      .applyConstraints({
        advanced: [{ zoom: next }],
      } as unknown as MediaTrackConstraints)
      .catch(() => {
        // The camera refused this factor; the viewfinder keeps the last good
        // one and the gesture simply reads as having hit the end of its range.
      });
  }, []);

  // --- Swap the video source, leaving the audio track running ---
  /**
   * Mid-recording the audio track is already being captured, so tearing the
   * whole stream down would silence the take. This asks for video alone,
   * stops only the outgoing camera, and hands back a fresh MediaStream
   * pairing the new video track with the original audio — a new object, so
   * the element it is attached to re-reads it.
   */
  const swapVideoTrack = useCallback(
    async (facing: "user" | "environment") => {
      const current = streamRef.current;
      if (!current) return;

      let replacement: MediaStream;
      try {
        replacement = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
        });
      } catch (err) {
        // The camera we have still works, and surfacing an error here would
        // replace a take in progress with an error screen. Stay put.
        const error = err as DOMException;
        console.error("camera swap failed:", error.name, error.message);
        return;
      }

      // Only now that the new camera is live: stopping the old video track
      // first would blank the viewfinder for as long as the request took.
      current.getVideoTracks().forEach((t) => t.stop());

      const next = new MediaStream();
      replacement.getVideoTracks().forEach((t) => next.addTrack(t));
      current.getAudioTracks().forEach((t) => next.addTrack(t));

      streamRef.current = next;
      setStream(next);
      facingModeRef.current = facing;
      setFacingMode(facing);
      adoptZoomRange(next);
    },
    [adoptZoomRange],
  );

  // --- Switch between front and back cameras ---
  const switchCamera = useCallback(
    async ({ keepAudio = false }: { keepAudio?: boolean } = {}) => {
      if (switchingRef.current) return;
      switchingRef.current = true;

      const next = facingModeRef.current === "environment" ? "user" : "environment";
      try {
        if (keepAudio) {
          await swapVideoTrack(next);
        } else {
          stopCamera();
          await requestCamera(next);
        }
      } finally {
        switchingRef.current = false;
      }
    },
    [stopCamera, requestCamera, swapVideoTrack],
  );

  // --- Auto-cleanup on unmount (critical: prevents camera staying active) ---
  useEffect(() => {
    return () => {
      killStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return {
    state,
    stream,
    facingMode,
    errorMessage,
    zoom,
    zoomRange,
    isOpticalZoom,
    requestCamera,
    switchCamera,
    setZoom,
    stopCamera,
  };
}
