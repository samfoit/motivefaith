"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Share, PlusSquare, MoreVertical, Download } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Device / browser detection
// ---------------------------------------------------------------------------

type Platform =
  | "ios-safari"
  | "ios-other"
  | "android-chrome"
  | "android-other"
  | "desktop-chrome"
  | "desktop-edge"
  | "desktop-firefox"
  | "desktop-other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop-other";

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);
  const isChrome = /Chrome/.test(ua) && !/Edg/.test(ua);
  const isEdge = /Edg/.test(ua);
  const isFirefox = /Firefox/.test(ua);

  if (isIOS) return isSafari ? "ios-safari" : "ios-other";
  if (isAndroid) return isChrome ? "android-chrome" : "android-other";
  if (isChrome) return "desktop-chrome";
  if (isEdge) return "desktop-edge";
  if (isFirefox) return "desktop-firefox";
  return "desktop-other";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const DISMISSED_KEY = "motive:pwa-install-dismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function wasDismissedRecently(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const ts = localStorage.getItem(DISMISSED_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* non-critical */
  }
}

// ---------------------------------------------------------------------------
// Instruction content per platform
// ---------------------------------------------------------------------------

interface Instructions {
  title: string;
  steps: { icon?: React.ReactNode; text: string }[];
}

function getInstructions(platform: Platform): Instructions {
  switch (platform) {
    case "ios-safari":
      return {
        title: "Install on iPhone / iPad",
        steps: [
          {
            icon: <Share className="w-5 h-5 text-brand" />,
            text: "Tap the Share button in the toolbar",
          },
          {
            icon: <PlusSquare className="w-5 h-5 text-brand" />,
            text: 'Scroll down and tap "Add to Home Screen"',
          },
          { text: 'Tap "Add" to confirm' },
        ],
      };
    case "ios-other":
      return {
        title: "Install on iPhone / iPad",
        steps: [
          { text: "Open this page in Safari for the best experience" },
          {
            icon: <Share className="w-5 h-5 text-brand" />,
            text: "Then tap the Share button",
          },
          {
            icon: <PlusSquare className="w-5 h-5 text-brand" />,
            text: 'And tap "Add to Home Screen"',
          },
        ],
      };
    case "android-chrome":
      return {
        title: "Install on Android",
        steps: [
          {
            icon: <MoreVertical className="w-5 h-5 text-brand" />,
            text: "Tap the menu (three dots) in the top right",
          },
          {
            icon: <Download className="w-5 h-5 text-brand" />,
            text: 'Tap "Install app" or "Add to Home screen"',
          },
          { text: 'Tap "Install" to confirm' },
        ],
      };
    case "android-other":
      return {
        title: "Install on Android",
        steps: [
          { text: "Open this page in Chrome for the best experience" },
          {
            icon: <MoreVertical className="w-5 h-5 text-brand" />,
            text: "Then tap the three-dot menu",
          },
          {
            icon: <Download className="w-5 h-5 text-brand" />,
            text: 'And tap "Install app"',
          },
        ],
      };
    case "desktop-chrome":
      return {
        title: "Install on your computer",
        steps: [
          {
            icon: <Download className="w-5 h-5 text-brand" />,
            text: "Click the install icon in the address bar",
          },
          { text: 'Or open the menu and click "Install MotiveFaith"' },
          { text: 'Click "Install" to confirm' },
        ],
      };
    case "desktop-edge":
      return {
        title: "Install on your computer",
        steps: [
          {
            icon: <Download className="w-5 h-5 text-brand" />,
            text: "Click the install icon in the address bar",
          },
          { text: "Or go to Settings (...) > Apps > Install this site" },
          { text: 'Click "Install" to confirm' },
        ],
      };
    case "desktop-firefox":
      return {
        title: "Add to your browser",
        steps: [
          { text: "Firefox doesn't support PWA install natively" },
          { text: "Bookmark this page for quick access" },
          { text: "Or try opening in Chrome or Edge to install" },
        ],
      };
    default:
      return {
        title: "Install MotiveFaith",
        steps: [
          {
            text: 'Check your browser menu for an "Install" or "Add to Home Screen" option',
          },
          {
            text: "Or try opening in Chrome, Edge, or Safari for full install support",
          },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform] = useState<Platform>(() => detectPlatform());
  const [hasPrompt, setHasPrompt] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already installed or recently dismissed
    if (isStandalone() || wasDismissedRecently()) return;

    // Small delay so the dashboard loads first
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Capture the native install prompt (Chrome/Edge on Android & desktop)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setHasPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleNativeInstall = useCallback(async () => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return false;
    prompt.prompt();
    const result = await prompt.userChoice;
    deferredPromptRef.current = null;
    setHasPrompt(false);
    if (result.outcome === "accepted") {
      markDismissed();
      setVisible(false);
    }
    return result.outcome === "accepted";
  }, []);

  const handleDismiss = useCallback(() => {
    markDismissed();
    setVisible(false);
  }, []);

  const handleInstallClick = useCallback(async () => {
    // Try native prompt first (Android Chrome, desktop Chrome/Edge)
    const installed = await handleNativeInstall();
    if (!installed) {
      // Native prompt wasn't available or was dismissed — the instructions
      // are already visible in the card, so nothing else to do
    }
  }, [handleNativeInstall]);

  const instructions = getInstructions(platform);
  const hasNativePrompt =
    platform === "android-chrome" ||
    platform === "desktop-chrome" ||
    platform === "desktop-edge";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-20 inset-x-0 z-50 px-4 pb-[env(safe-area-inset-bottom)]"
        >
          <div
            className={cn(
              "mx-auto max-w-md rounded-xl shadow-lg",
              "bg-[var(--color-bg-elevated)] border border-[var(--color-bg-secondary)]",
              "p-5",
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-lg font-bold">H</span>
                </div>
                <div>
                  <h3 className="font-display font-semibold text-[var(--color-text-primary)] text-sm">
                    {instructions.title}
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    Get the full app experience
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="p-1.5 -mr-1.5 -mt-1 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4 text-[var(--color-text-tertiary)]" />
              </button>
            </div>

            {/* Steps */}
            <ol className="space-y-3 mb-4">
              {instructions.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                      step.icon
                        ? "bg-[var(--color-brand-light)]"
                        : "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]",
                    )}
                  >
                    {step.icon ?? i + 1}
                  </span>
                  <span className="text-sm text-[var(--color-text-primary)] pt-0.5 leading-snug">
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>

            {/* Actions */}
            <div className="flex gap-2">
              {hasNativePrompt && hasPrompt && (
                <Button onClick={handleInstallClick} className="flex-1">
                  <Download className="w-4 h-4" />
                  <span>Install</span>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={handleDismiss}
                className={cn(
                  "text-[var(--color-text-secondary)]",
                  hasNativePrompt && hasPrompt ? "" : "flex-1",
                )}
              >
                Maybe later
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// beforeinstallprompt type (not in standard lib.dom)
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
