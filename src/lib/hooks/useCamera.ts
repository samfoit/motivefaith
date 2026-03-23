"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CameraState = "unsupported" | "prompt" | "granted" | "denied";

export interface UseCameraOptions {
  /** Request audio alongside video (needed for video recording). */
  audio?: boolean;
}

export interface UseCameraReturn {
  state: CameraState;
  stream: MediaStream | null;
  /** Error message to display to the user (e.g. "No camera found"). */
  errorMessage: string | null;
  requestCamera: (facingMode?: "user" | "environment") => Promise<void>;
  switchCamera: () => Promise<void>;
  stopCamera: () => void;
}

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

  // Ref always mirrors the latest stream so cleanup can access it
  // without depending on React state lifecycle.
  const streamRef = useRef<MediaStream | null>(null);

  // Track current facing mode so switchCamera can toggle it.
  const facingModeRef = useRef<"user" | "environment">("environment");

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
    [audio],
  );

  // --- Switch between front and back cameras ---
  const switchCamera = useCallback(async () => {
    const next = facingModeRef.current === "environment" ? "user" : "environment";
    stopCamera();
    await requestCamera(next);
  }, [stopCamera, requestCamera]);

  // --- Auto-cleanup on unmount (critical: prevents camera staying active) ---
  useEffect(() => {
    return () => {
      killStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return { state, stream, errorMessage, requestCamera, switchCamera, stopCamera };
}
