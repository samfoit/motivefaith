"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { invitePath } from "@/lib/constants/pending-invite";
import {
  renderStreakCard,
  type CardFormat,
  type CardTheme,
} from "@/lib/utils/share-card";

interface ShareCardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  streak: number;
  /** "day" for daily habits, "week" for weekly ones. */
  unit: string;
  /** The sharer's own username — the card's footer links back to their invite. */
  username: string | null;
}

const FORMATS: { value: CardFormat; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "story", label: "Story" },
];

const THEMES: { value: CardTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ShareCardSheet({
  open,
  onOpenChange,
  title,
  streak,
  unit,
  username,
}: ShareCardSheetProps) {
  const [format, setFormat] = useState<CardFormat>("square");
  const [theme, setTheme] = useState<CardTheme>("light");
  const { show, ToastElements } = useToast();

  // Held so share and save send the exact bytes that were previewed, rather
  // than redrawing and hoping for the same result.
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);

  const inviteUrl = username
    ? `${typeof window !== "undefined" ? window.location.host : "motivefaith.app"}${invitePath(username)}`
    : "motivefaith.app";

  // Everything the drawing depends on, as one value. What is on screen is
  // either the card for this key or it is stale, which makes "rendering"
  // something to derive rather than a second piece of state to keep in step —
  // and keeps the effect from setting state synchronously as it starts.
  const key = [format, theme, title, streak, unit, inviteUrl].join("\u0000");
  const [rendered, setRendered] = useState<{ key: string; url: string } | null>(null);
  const rendering = rendered?.key !== key;
  const preview = rendered?.url ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    renderStreakCard({ title, streak, unit, inviteUrl, format, theme })
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
  }, [open, key, title, streak, unit, inviteUrl, format, theme, show]);

  // The object URL outlives the render that made it, so it is released when the
  // sheet goes away rather than in the effect that created it.
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const fileName = `motivefaith-${streak}-${unit}-streak.png`;

  const handleShare = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;

    const file = new File([blob], fileName, { type: "image/png" });

    // Some targets take an image with accompanying text, some refuse the
    // combination outright. Ask about the richer payload first and fall back
    // rather than letting a refusal read as a failure.
    const withText = { files: [file], text: `${title} — ${streak} ${unit}${streak === 1 ? "" : "s"}. ${inviteUrl}` };
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

        {/* Preview — the whole card, so what is posted is never a surprise. */}
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

        <Segmented
          label="Format"
          options={FORMATS}
          value={format}
          onChange={setFormat}
        />
        <Segmented
          label="Theme"
          options={THEMES}
          value={theme}
          onChange={setTheme}
        />

        <div className="space-y-2 pt-1">
          {canShareFiles && (
            <Button
              className="w-full"
              size="lg"
              onClick={handleShare}
              disabled={!preview || rendering}
            >
              <Share2 className="w-4 h-4" />
              <span>Share</span>
            </Button>
          )}
          <Button
            variant={canShareFiles ? "secondary" : "primary"}
            className="w-full"
            size={canShareFiles ? "md" : "lg"}
            onClick={handleSave}
            disabled={!preview || rendering}
          >
            <Download className="w-4 h-4" />
            <span>Save image</span>
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
