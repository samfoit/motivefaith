"use client";

import { useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileProps {
  onToken: (token: string) => void;
  onExpire?: () => void;
}

export function Turnstile({ onToken, onExpire }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey) return;
    if (widgetIdRef.current !== null) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onToken,
      "expired-callback": () => {
        onExpire?.();
      },
      "error-callback": () => {
        onExpire?.();
      },
      theme: "auto",
      size: "normal",
    });
  }, [siteKey, onToken, onExpire]);

  useEffect(() => {
    // If the script is already loaded, render immediately
    if (window.turnstile) {
      renderWidget();
      return undefined;
    }

    // If the script tag already exists, wait for it to load (max 30s)
    if (document.getElementById(SCRIPT_ID)) {
      let elapsed = 0;
      const interval = setInterval(() => {
        elapsed += 100;
        if (window.turnstile) {
          clearInterval(interval);
          renderWidget();
        } else if (elapsed >= 30_000) {
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }

    // Load the script
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => renderWidget();
    document.head.appendChild(script);
    return undefined;
  }, [renderWidget]);

  // Cleanup widget on unmount
  useEffect(() => {
    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  if (!siteKey) return null;

  return <div ref={containerRef} className="flex justify-center" />;
}
