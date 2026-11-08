import Link from "next/link";
import { LandingInteractive } from "./landing-client";
import { GraceDemo, HourDemo, ProofDemo } from "./landing-demos";
import type React from "react";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { HeroSky } from "@/components/sky/HeroSky";

// Rendered per request, like every page, and never `force-static`: a page
// built ahead of time has no CSP nonce on its inline scripts, so the browser
// refuses them all and nothing on it runs (see the root layout).

/* ── Data ─────────────────────────────────────────────────── */

const WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** Footer links: a 44px tap target around small text, and the lamp's focus ring. */
const FOOTER_LINK =
  "inline-flex items-center min-h-11 hover:underline underline-offset-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink";

/* ── Page (Server Component — zero motion/react JS shipped) ── */

export default function LandingPage() {
  return (
    <div
      className="landing min-h-screen bg-bg-primary font-sans"
      style={{ color: "var(--color-text-primary)" }}
    >
      {/* Client island: auth redirect, scroll nav */}
      <LandingInteractive />

      {/* ── Nav ── */}
      <nav
        id="landing-nav"
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-transparent"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link
            href="/"
            className="font-display text-xl font-medium rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
            style={{ color: "var(--color-brand-ink)" }}
          >
            MotiveFaith
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "hidden sm:inline-flex",
              )}
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className={buttonVariants({ variant: "primary" })}
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── the live sky behind it, hills along its foot */}
      <section className="relative isolate overflow-hidden pt-32 pb-60 sm:pt-40 sm:pb-64 lg:pb-80 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 -z-10">
          <HeroSky />
        </div>
        <div className="mx-auto max-w-6xl flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          <div className="flex-1 text-center lg:text-left landing-hero-text">
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-medium leading-tight tracking-tight mb-6">
              Build habits that stick.{" "}
              <span style={{ color: "var(--color-brand-ink)" }}>Together.</span>
            </h1>
            <p
              className="text-lg sm:text-xl max-w-xl mx-auto lg:mx-0 mb-8"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Track your habits, maintain streaks, and stay accountable with
              friends who cheer you on every step of the way.
            </p>
            <Link
              href="/auth/signup"
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              Get Started
            </Link>
            <p
              className="mt-10 font-display text-lg italic max-w-md mx-auto lg:mx-0"
              style={{ color: "var(--color-text-secondary)" }}
            >
              &ldquo;Though one may be overpowered, two can defend themselves. A
              cord of three strands is not quickly broken.&rdquo;
              <span
                className="block mt-1 not-italic font-sans text-sm"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Ecclesiastes 4:12
              </span>
            </p>
          </div>

          <div className="flex-1 w-full max-w-sm lg:max-w-md xl:max-w-120 landing-hero-mockup">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ── Show up, and the days you don't: two demos to play with ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight text-center text-balance mb-14 sm:mb-20">
            For the days you show up, and the days you don&rsquo;t
          </h2>

          <div className="space-y-20 lg:space-y-28">
            <DemoRow
              title="Proof your partners can see"
              line="Check in with a tap, a photo, a voice note or a few words. Your partners see it and cheer."
            >
              <ProofDemo />
            </DemoRow>
            <DemoRow
              flip
              title="Grace, not guilt"
              line="Life happens. Take a rain check, say why, and keep your streak."
            >
              <GraceDemo />
            </DemoRow>
          </div>
        </div>
      </section>

      {/* ── It changes with your day: drag through it ── */}
      <section className="pt-16 pb-12 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight text-center text-balance mb-10 sm:mb-14">
            An app that changes with your day
          </h2>
          <HourDemo />
        </div>
      </section>

      {/* ── Final CTA ── a phone's verse sits close above it */}
      <section className="pt-12 pb-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight text-balance mb-10">
            Ready to build better habits?
          </h2>
          <Link
            href="/auth/signup"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Get Started
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="py-8 px-4 sm:px-6 lg:px-8 border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span
              className="font-display font-medium"
              style={{ color: "var(--color-brand-ink)" }}
            >
              MotiveFaith
            </span>
            <span
              className="text-xs"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              &copy; 2026
            </span>
          </div>
          <div
            className="flex items-center gap-x-4 text-sm flex-wrap justify-center sm:justify-end"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {/* The nav hides Sign in on phones, so it lives here too */}
            <Link href="/auth/login" className={FOOTER_LINK}>
              Sign in
            </Link>
            <Link href="/legal/terms" className={FOOTER_LINK}>
              Terms
            </Link>
            <Link href="/legal/privacy" className={FOOTER_LINK}>
              Privacy
            </Link>
            <Link href="/legal/dmca" className={FOOTER_LINK}>
              DMCA
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── A demo beside its headline, alternating sides on a wide screen ── */

function DemoRow({
  title,
  line,
  flip = false,
  children,
}: {
  title: string;
  line: string;
  flip?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-16 items-center">
      <div
        className={cn(
          "max-w-md mx-auto text-center lg:text-left lg:mx-0",
          flip && "lg:order-2",
        )}
      >
        <h3 className="font-display text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-balance mb-4">
          {title}
        </h3>
        <p className="text-lg" style={{ color: "var(--color-text-secondary)" }}>
          {line}
        </p>
      </div>
      <div className={cn("w-full max-w-md mx-auto", flip && "lg:order-1")}>
        {children}
      </div>
    </div>
  );
}

/* ── Hero Mockup (pure server markup + CSS animations) ── */

function HeroMockup() {
  return (
    <div
      className="bg-bg-elevated rounded-lg shadow-lg p-5 lg:p-6 border"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Habit card header. The flame below shares the tile's column, so
          every line of text starts at the same edge. */}
      <div className="flex items-center gap-3 lg:gap-4">
        <div
          className="w-10 h-10 lg:w-12 lg:h-12 shrink-0 rounded-md flex items-center justify-center text-lg lg:text-2xl"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-brand) 14%, var(--color-bg-elevated))",
          }}
        >
          {"\u{1F64F}"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-base lg:text-lg">Morning prayer</p>
          <p
            className="text-xs lg:text-sm"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Every day at 6:30 AM
          </p>
        </div>
        <CheckDisc
          className="w-9 h-9 lg:w-10 lg:h-10 shrink-0 rounded-full landing-checkmark"
          style={{ boxShadow: "var(--lamp-glow-done)" }}
        />
      </div>

      {/* Streak, then a dot for each day this week */}
      <div className="mt-5 lg:mt-6">
        <div className="flex items-center gap-3 lg:gap-4">
          <span className="w-10 lg:w-12 shrink-0 flex justify-center">
            {/* The flame on a flat gold tint: the app's soft halo washes out by day */}
            <svg
              aria-hidden
              viewBox="-6 -6 36 36"
              className="w-8 h-8 lg:w-9 lg:h-9"
            >
              <circle
                cx="12"
                cy="12"
                r="18"
                style={{
                  fill: "color-mix(in oklab, var(--color-brand) 30%, var(--color-bg-elevated))",
                }}
              />
              <path
                d="M12 2.5c1.2 3.6 5.5 5.6 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4.4 2.7-5.5.3 1.8 1.1 2.8 2.2 3.3 0-3.3-.9-5.8.6-8.4z"
                style={{ fill: "var(--color-streak)" }}
              />
            </svg>
          </span>
          <span className="text-sm lg:text-base font-medium">
            14-day streak
          </span>
        </div>

        {/* Edge to edge: Monday under the tile, Sunday under the check */}
        <div className="mt-4 flex justify-between">
          {WEEK_DAYS.map((day, i) => (
            <div
              key={`${day}-${i}`}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className="text-[11px] lg:text-xs font-medium"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {day}
              </span>
              <CheckDisc
                done={i < 5}
                className="w-6 h-6 lg:w-7 lg:h-7 landing-dot"
                style={{ animationDelay: `${800 + i * 100}ms` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Encouragement bubble */}
      <div className="mt-5 lg:mt-6 bg-brand-light rounded-md px-3 py-2.5 lg:px-4 lg:py-3 flex items-center gap-2.5 landing-encourage">
        <span className="text-base lg:text-lg">{"\u{1F4AA}"}</span>
        <p
          className="text-xs lg:text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <span className="font-semibold">Alex</span> sent you an encouragement!
        </p>
      </div>
    </div>
  );
}

/**
 * A gold disc with a check, or an empty one. Disc and check are one drawing,
 * so the check can't drift off-center however the browser lays out or paints
 * the box. The check is nudged half a unit up, where its weight, which sits in
 * the bottom stroke, reads as centered.
 */
function CheckDisc({
  done = true,
  className,
  style,
}: {
  done?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg aria-hidden viewBox="0 0 40 40" className={className} style={style}>
      <circle
        cx="20"
        cy="20"
        r="20"
        style={{
          fill: done ? "var(--color-brand)" : "var(--color-bg-secondary)",
        }}
      />
      {done && (
        <path
          d="M13 19.75l4.5 4.5L27 14.75"
          fill="none"
          strokeWidth={3.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: "var(--color-on-brand)" }}
        />
      )}
    </svg>
  );
}
