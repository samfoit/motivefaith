"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Camera,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { createClient } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import { compressImage } from "@/lib/utils/compress-image";
import { ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES, MIME_TO_EXT } from "@/lib/utils/media-types";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { ModeHeader } from "@/components/ui/ModeHeader";

const CameraCapture = dynamic(
  () => import("@/components/habits/CameraCapture").then((m) => m.CameraCapture),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompletionType = "photo" | "video" | "message" | "quick";
type Mode = "select" | "content" | "message";

export interface CompletionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habitId: string;
  habitTitle: string;
  habitEmoji: string;
  onComplete: (params: {
    type: CompletionType;
    evidenceUrl?: string;
    notes?: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import {
  MAX_MESSAGE_LENGTH,
  MAX_IMAGE_SIZE_MB,
  MAX_VIDEO_SIZE_MB,
} from "@/lib/constants/limits";


function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompletionForm({
  open,
  onOpenChange,
  habitId,
  habitTitle,
  habitEmoji,
  onComplete,
}: CompletionFormProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive media type from selected file
  const mediaType: "photo" | "video" | null = selectedFile
    ? selectedFile.type.startsWith("video")
      ? "video"
      : "photo"
    : null;

  // Cleanup preview URL on unmount or when changing
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const reset = () => {
    setMode("select");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setSelectedFile(null);
    setMessage("");
    setError(null);
    setIsSubmitting(false);
    setCameraOpen(false);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  // --- Option selection ---

  const handleContentSelect = () => {
    setError(null);
    if (isCameraSupported()) {
      setCameraOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleMessageSelect = () => {
    setError(null);
    setMode("message");
  };

  // --- Camera capture handlers ---

  const handleCameraCapture = (file: File) => {
    setCameraOpen(false);
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setMode("content");
  };

  const handleCameraFallback = () => {
    // Don't close camera here — Radix Dialog's focus management will
    // dismiss the native file picker if the Sheet re-opens. Leave camera
    // open behind the picker; it closes when a file is selected.
    fileInputRef.current?.click();
  };

  const handleCameraClose = () => {
    setCameraOpen(false);
  };

  // --- File handling ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type) && !ALLOWED_VIDEO_TYPES.has(file.type)) {
      setError("Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, MOV, or WebM.");
      return;
    }

    if (
      ALLOWED_IMAGE_TYPES.has(file.type) &&
      file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024
    ) {
      setError(`Image must be under ${MAX_IMAGE_SIZE_MB}MB`);
      return;
    }

    if (
      ALLOWED_VIDEO_TYPES.has(file.type) &&
      file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024
    ) {
      setError(`Video must be under ${MAX_VIDEO_SIZE_MB}MB`);
      return;
    }

    // Close camera overlay if it was open (fallback flow)
    setCameraOpen(false);
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
    setMode("content");
  };

  // --- Upload ---

  const uploadFile = async (
    file: File,
    type: "photo" | "video",
  ): Promise<string> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    let uploadBlob: Blob = file;
    let contentType = file.type;

    let ext = MIME_TO_EXT[file.type] ?? "bin";

    if (type === "photo") {
      uploadBlob = await compressImage(file);
      ext = "webp";
      contentType = "image/webp";
    }

    const path = `${user.id}/${habitId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("completions")
      .upload(path, uploadBlob, { contentType });

    if (uploadError) throw uploadError;

    // Store the path — signed URLs are resolved at render time via
    // useEvidenceUrls so they never permanently expire.
    return path;
  };

  // --- Submit handlers ---

  const handleContentSubmit = async () => {
    if (!selectedFile || !mediaType) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const url = await uploadFile(selectedFile, mediaType);
      onComplete({ type: mediaType, evidenceUrl: url });
      handleClose(false);
    } catch (err) {
      console.error("Upload failed:", err);
      setError("Upload failed. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleMessageSubmit = () => {
    if (!message.trim()) return;
    setIsSubmitting(true);
    onComplete({ type: "message", notes: message.trim() });
    handleClose(false);
  };

  // --- Render ---

  const sheetTitle =
    mode === "select" ? (
      <span className="flex items-center gap-2">
        <span>{habitEmoji}</span>
        <span>Log completion</span>
      </span>
    ) : undefined;

  const isPhoto = mediaType === "photo";

  return (
    <>
      {/* Hidden file input — must live outside Sheet so it stays mounted when camera is open */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFileChange}
      />

      <Sheet
        open={open && !cameraOpen}
        onOpenChange={handleClose}
        size="md"
        title={sheetTitle}
        description={mode === "select" ? habitTitle : undefined}
      >
        {/* Error banner */}
        {error && <ErrorBanner message={error} className="mb-3" />}

        <>
          {/* --- Select mode --- */}
          {mode === "select" && (
            <div className="cf-fade-in grid grid-cols-2 gap-3">

              <button
                type="button"
                onClick={handleContentSelect}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-lg transition-all",
                  "hover:scale-[1.02] active:scale-95",
                )}
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-brand) 15%, var(--color-bg-secondary))",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-brand) 15%, transparent)",
                  }}
                >
                  <Camera
                    className="w-5 h-5"
                    style={{ color: "var(--color-brand)" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    Content
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Photo or video
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={handleMessageSelect}
                className={cn(
                  "flex flex-col items-center gap-2 p-5 rounded-lg transition-all",
                  "hover:scale-[1.02] active:scale-95",
                )}
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-streak) 15%, var(--color-bg-secondary))",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-streak) 15%, transparent)",
                  }}
                >
                  <MessageSquare
                    className="w-5 h-5"
                    style={{ color: "var(--color-streak)" }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    Message
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Write a note
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* --- Content review mode (photo/video) --- */}
          {mode === "content" && (
            <div className="cf-slide-in space-y-4">

              <ModeHeader
                label={isPhoto ? "Photo proof" : "Video proof"}
                onBack={() => {
                  setMode("select");
                  setSelectedFile(null);
                  if (preview) URL.revokeObjectURL(preview);
                  setPreview(null);
                }}
              />
              {preview && (
                <div className="relative rounded-lg overflow-hidden bg-[var(--color-bg-secondary)]">
                  {isPhoto ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={preview}
                      alt="Photo preview"
                      className="w-full max-h-64 object-contain"
                    />
                  ) : (
                    <video
                      src={preview}
                      controls
                      className="w-full max-h-64"
                      playsInline
                    />
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    if (isCameraSupported()) {
                      setCameraOpen(true);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  disabled={isSubmitting}
                >
                  Change
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleContentSubmit}
                  loading={isSubmitting}
                  disabled={!selectedFile || isSubmitting}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}

          {/* --- Message mode --- */}
          {mode === "message" && (
            <div className="cf-slide-in space-y-4">

              <ModeHeader label="Reflection" onBack={() => setMode("select")} />
              <TextArea
                placeholder="How did it go? What did you learn?"
                value={message}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                    setMessage(e.target.value);
                  }
                }}
                rows={4}
                autoFocus
              />
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-xs font-mono",
                    message.length >= MAX_MESSAGE_LENGTH
                      ? "text-miss"
                      : "text-[var(--color-text-tertiary)]",
                  )}
                >
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
                <Button
                  onClick={handleMessageSubmit}
                  disabled={!message.trim() || isSubmitting}
                  loading={isSubmitting}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}
        </>

        {/* Loading overlay */}
        {isSubmitting && mode !== "message" && (
          <div className="absolute inset-0 flex items-center justify-center bg-elevated/80 rounded-t-lg z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p className="text-sm text-[var(--color-text-secondary)]">
                Uploading...
              </p>
            </div>
          </div>
        )}
      </Sheet>

      {/* Camera overlay — rendered outside Sheet so it's truly full-screen */}
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={handleCameraClose}
          onFallback={handleCameraFallback}
        />
      )}
    </>
  );
}

