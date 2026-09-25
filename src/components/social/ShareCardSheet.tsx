"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ImagePlus, Loader2, Share2, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { invitePath } from "@/lib/constants/pending-invite";
import { ALLOWED_IMAGE_TYPES } from "@/lib/utils/media-types";
import { useMyUsername } from "@/lib/hooks/useMyUsername";
import { resolveEvidenceUrls } from "@/lib/utils/evidence";
import {
  renderStreakCard,
  type CardFormat,
  type CardTheme,
  type CardLayout,
} from "@/lib/utils/share-card";

interface ShareCardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  streak: number;
  /** "day" for daily habits, "week" for weekly ones. */
  unit: string;
  /**
   * The sharer's own username, when the caller already has it. Left out, the
   * sheet fetches it — which is what lets it be dropped on the dashboard,
   * whose document carries no user data by design.
   */
  username?: string | null;
  /**
   * Storage paths of photo evidence on this habit, newest first. Offered as
   * one-tap choices so that "add a photo" does not mean "go and think of
   * one" — the pictures people already took of the practice are the most
   * likely thing they would have picked anyway.
   */
  evidencePaths?: string[];
}

const FORMATS: { value: CardFormat; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "story", label: "Story" },
];

const THEMES: { value: CardTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const PHOTO_LAYOUTS: { value: Exclude<CardLayout, "default">; label: string }[] = [
  { value: "bleed", label: "Full" },
  { value: "inset", label: "Framed" },
];

export function ShareCardSheet({
  open,
  onOpenChange,
  title,
  streak,
  unit,
  username: usernameProp,
  evidencePaths,
}: ShareCardSheetProps) {
  const { data: username } = useMyUsername(usernameProp);
  const [format, setFormat] = useState<CardFormat>("square");
  const [theme, setTheme] = useState<CardTheme>("dark");
  const [photoLayout, setPhotoLayout] =
    useState<Exclude<CardLayout, "default">>("bleed");
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const { show, ToastElements } = useToast();

  const fileRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const photoUrlRef = useRef<string | null>(null);

  const inviteUrl = username
    ? `${typeof window !== "undefined" ? window.location.host : "motivefaith.app"}${invitePath(username)}`
    : "motivefaith.app";

  const layout: CardLayout = photo ? photoLayout : "default";

  // Everything the drawing depends on, as one value. What is on screen is
  // either the card for this key or it is stale, which makes "rendering"
  // something to derive rather than a second piece of state to keep in step.
  const key = [format, theme, layout, photoName ?? "", title, streak, unit, inviteUrl].join("\u0000");
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null);
  const rendering = rendered?.key !== key;
  const preview = rendered?.url ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    renderStreakCard({ title, streak, unit, inviteUrl, format, theme, layout, photo })
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setRendered({ key, url: urlRef.current });
      })
      .catch(() => {
        if (!cancelled) show({ variant: "error", title: "Could not build the card" });
      });

    return () => {
      cancelled = true;
    };
  }, [open, key, title, streak, unit, inviteUrl, format, theme, layout, photo, show]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  // Signed URLs are short-lived and cost a request, so they are resolved when
  // the sheet opens rather than with the page behind it.
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const evidenceKey = (evidencePaths ?? []).join("\u0000");
  useEffect(() => {
    if (!open || !evidencePaths?.length) return;
    let cancelled = false;
    resolveEvidenceUrls(evidencePaths.slice(0, 6))
      .then((map) => {
        if (cancelled) return;
        setEvidenceUrls(
          evidencePaths.map((path) => map.get(path)).filter(Boolean) as string[],
        );
      })
      .catch(() => {
        // No thumbnails is a smaller loss than a broken sheet; the file
        // picker below still works.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, evidenceKey]);

  /**
   * Load a picked image so it can be drawn.
   *
   * `crossOrigin` is load-bearing for the evidence photos: the signed URLs are
   * a different origin, and without it the canvas taints and `toBlob` throws a
   * SecurityError at the moment the user taps share. Supabase Storage answers
   * with `Access-Control-Allow-Origin: *`, which is what makes this work —
   * verified end to end against a real signed URL rather than assumed.
   */
  const adoptImage = useCallback(
    (src: string, name: string, onFail: () => void) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        setPhoto(img);
        setPhotoName(name);
      };
      img.onerror = onFail;
      img.src = src;
    },
    [],
  );

  const handlePickPhoto = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      show({ variant: "error", title: "That file isn't an image we can use" });
      return;
    }

    // An object URL rather than a data URL: the photo never leaves the device,
    // and nothing has to base64 a few megabytes to draw it.
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    photoUrlRef.current = objectUrl;

    const img = new Image();
    img.onload = () => {
      setPhoto(img);
      setPhotoName(`${file.name}:${file.size}`);
    };
    img.onerror = () => {
      show({ variant: "error", title: "Could not open that image" });
    };
    img.src = objectUrl;
  }, [show]);

  const handleRemovePhoto = useCallback(() => {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    setPhoto(null);
    setPhotoName(null);
  }, []);

  const fileName = `motivefaith-${streak}-${unit}-streak.png`;

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;

    const file = new File([blob], fileName, { type: "image/png" });

    // Some targets take an image with accompanying text, some refuse the
    // combination outright. Ask about the richer payload first and fall back
    // rather than letting a refusal read as a failure.
    const withText = {
      files: [file],
      text: `${streak} ${unit}${streak === 1 ? "" : "s"} of ${title}. ${inviteUrl}`,
    };
    const filesOnly = { files: [file] };
    const payload = navigator.canShare?.(withText)
      ? withText
      : navigator.canShare?.(filesOnly)
        ? filesOnly
        : null;

    if (!payload) {
      show({
        variant: "info",
        title: "Sharing isn't available here",
        description: "Save the image and post it from your photo library.",
      });
      return;
    }

    try {
      await navigator.share(payload);
    } catch (err) {
      // Dismissing the OS sheet rejects with AbortError. That is a choice.
      if (err instanceof Error && err.name === "AbortError") return;
      show({ variant: "error", title: "Could not open the share sheet" });
    }
  }, [fileName, title, streak, unit, inviteUrl, show]);

  const handleSave = useCallback(() => {
    if (!urlRef.current) return;
    const a = document.createElement("a");
    a.href = urlRef.current;
    a.download = fileName;
    a.click();
  }, [fileName]);

  const canShareFiles =
    typeof navigator !== "undefined" && !!navigator.canShare && !!navigator.share;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} size="lg" showHandle>
      {ToastElements}
      <div className="px-4 py-2 space-y-4">
        <h2
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-lg)" }}
        >
          Share your streak
        </h2>

        {/* The card as it will be sent. Nothing is shared that was not seen. */}
        <div className="flex justify-center">
          <div
            className={cn(
              "relative overflow-hidden rounded-xl bg-[var(--color-bg-secondary)]",
              format === "square" ? "w-56 h-56" : "w-44 h-[19.5rem]",
            )}
          >
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Preview of the card you are about to share"
                className="w-full h-full object-cover"
              />
            )}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-secondary)]/70">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-tertiary)]" />
              </div>
            )}
          </div>
        </div>

        <Segmented label="Format" options={FORMATS} value={format} onChange={setFormat} />
        <Segmented label="Theme" options={THEMES} value={theme} onChange={setTheme} />

        {/* A photo is an upgrade, never a requirement — the card above is
            finished before anyone touches this. */}
        {photo ? (
          <>
            <Segmented
              label="Photo"
              options={PHOTO_LAYOUTS}
              value={photoLayout}
              onChange={setPhotoLayout}
            />
            <button
              type="button"
              onClick={handleRemovePhoto}
              className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Remove photo</span>
            </button>
          </>
        ) : (
          <div className="space-y-2">
            {/* Their own evidence photos first. Someone who does not know what
                to post is the reason the default card exists at all; offering
                the pictures they already took of this very habit is the same
                idea one step further. */}
            {evidenceUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {evidenceUrls.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() =>
                      adoptImage(url, `evidence:${i}`, () =>
                        show({ variant: "error", title: "Could not open that photo" }),
                      )
                    }
                    className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-[var(--color-bg-secondary)] transition-opacity active:opacity-70"
                    aria-label={`Use photo ${i + 1} from this habit`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              {/* Button wraps its children in one block-level span, so the
                  icon stacked above the label. An explicit row keeps them
                  side by side. */}
              <span className="inline-flex items-center gap-1.5">
                <ImagePlus className="w-4 h-4" />
                {evidenceUrls.length > 0 ? "Choose another photo" : "Add a photo"}
              </span>
            </Button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={[...ALLOWED_IMAGE_TYPES].join(",")}
          className="hidden"
          onChange={handlePickPhoto}
        />

        <div className="space-y-2 pt-1">
          {canShareFiles && (
            <Button
              className="w-full"
              size="lg"
              onClick={handleShare}
              disabled={!preview || rendering}
            >
              <span className="inline-flex items-center gap-1.5">
                <Share2 className="w-4 h-4" />
                Share
              </span>
            </Button>
          )}
          <Button
            variant={canShareFiles ? "secondary" : "primary"}
            className="w-full"
            size={canShareFiles ? "md" : "lg"}
            onClick={handleSave}
            disabled={!preview || rendering}
          >
            <span className="inline-flex items-center gap-1.5">
              <Download className="w-4 h-4" />
              Save image
            </span>
          </Button>
        </div>

        <p className="text-xs text-[var(--color-text-tertiary)] text-center">
          Only this habit and your streak. Partners are never named.
        </p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      <div
        className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary)]"
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              value === option.value
                ? "bg-brand text-white"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
