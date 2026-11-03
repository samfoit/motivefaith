"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Tiny client island: handles auth-redirect and scroll-nav styling via
 * IntersectionObserver (zero main-thread cost during scrolling).
 * Renders a 1px sentinel div used for scroll detection — all other
 * markup is server-rendered in page.tsx.
 */
export function LandingInteractive() {
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Catch stray auth params that land on the root page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error_code");
    const code = params.get("code");

    if (errorCode === "otp_expired") {
      router.replace("/auth/forgot-password?expired=true");
    } else if (code && /^[a-zA-Z0-9._-]+$/.test(code)) {
      router.replace(`/auth/callback?code=${encodeURIComponent(code)}`);
    }
  }, [router]);

  // Scroll detection via IntersectionObserver on a sentinel div.
  // When the sentinel scrolls out of view (past ~50px due to rootMargin),
  // toggle the nav background classes.  Zero main-thread work during scroll.
  useEffect(() => {
    const el = sentinelRef.current;
    const nav = document.getElementById("landing-nav");
    if (!el || !nav) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          nav.classList.remove("bg-bg-elevated", "shadow-md");
          nav.classList.add("bg-transparent");
        } else {
          nav.classList.add("bg-bg-elevated", "shadow-md");
          nav.classList.remove("bg-transparent");
        }
      },
      { rootMargin: "-50px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Sentinel element for scroll detection — invisible, layout-free
  return <div ref={sentinelRef} aria-hidden className="absolute top-0 h-px w-px" />;
}
