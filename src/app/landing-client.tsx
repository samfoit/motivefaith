"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ── Fact data ── */

const FACTS = [
  {
    emoji: "\u{1F4D6}",
    text: "\u2018As iron sharpens iron, so one person sharpens another.\u2019 \u2014 Proverbs 27:17. Partners in faith make each other stronger.",
  },
  {
    emoji: "\u{1F525}",
    text: "Streak motivation is real: people are 2.4x more likely to act when they have an active streak. Stay faithful daily.",
  },
  {
    emoji: "\u{1F64F}",
    text: "\u2018Devote yourselves to prayer, being watchful and thankful.\u2019 \u2014 Colossians 4:2. Consistency in prayer transforms your walk.",
  },
  {
    emoji: "\u{1F91D}",
    text: "People who share their goals with a friend are 65% more likely to follow through. That\u2019s the power of fellowship.",
  },
  {
    emoji: "\u271D\uFE0F",
    text: "\u2018Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.\u2019 \u2014 Galatians 6:9",
  },
];

/**
 * Tiny client island: handles auth-redirect, scroll-nav styling via
 * IntersectionObserver (zero main-thread cost during scrolling), and
 * IO-triggered CSS animations.
 * Renders a 1px sentinel div used for scroll detection — all other
 * markup is server-rendered in page.tsx.
 */
export function LandingInteractive() {
  const router = useRouter();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const animObserverRef = useRef<IntersectionObserver | null>(null);

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

  // IntersectionObserver: trigger CSS animations on scroll
  const setupAnimObserver = useCallback(() => {
    if (animObserverRef.current) return;
    animObserverRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            animObserverRef.current?.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "-50px" },
    );
    document
      .querySelectorAll(".landing-animate-on-scroll")
      .forEach((el) => animObserverRef.current!.observe(el));
  }, []);

  useEffect(() => {
    setupAnimObserver();
    return () => animObserverRef.current?.disconnect();
  }, [setupAnimObserver]);

  // Sentinel element for scroll detection — invisible, layout-free
  return <div ref={sentinelRef} aria-hidden className="absolute top-0 h-px w-px" />;
}

/**
 * Small client component for the rotating fact carousel.
 * ~2KB hydrated vs ~60KB for the old full-page motion/react bundle.
 */
export function FactCarousel() {
  const [factIndex, setFactIndex] = useState(0);
  const [factVisible, setFactVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setFactVisible(false);
      setTimeout(() => {
        setFactIndex((prev) => (prev + 1) % FACTS.length);
        setFactVisible(true);
      }, 300);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const currentFact = FACTS[factIndex];

  return (
    <div
      className="flex items-start gap-3 transition-all duration-300"
      style={{
        opacity: factVisible ? 1 : 0,
        transform: factVisible ? "translateY(0)" : "translateY(-12px)",
      }}
    >
      <span className="text-xl shrink-0 mt-0.5">{currentFact.emoji}</span>
      <p
        className="text-sm leading-relaxed"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {currentFact.text}
      </p>
    </div>
  );
}
