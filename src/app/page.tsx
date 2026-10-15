import Link from "next/link";
import { LandingInteractive, FactCarousel } from "./landing-client";
import type React from "react";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { palette } from "@/lib/lamplight/palette";
import { HeroSky } from "@/components/sky/HeroSky";
import { SkyBand, SkyStarField } from "@/components/sky/SkyDrawing";

export const dynamic = "force-static";

/* ── Data ─────────────────────────────────────────────────── */

const FEATURES = [
  {
    emoji: "\u{1F64F}",
    title: "Track any habit",
    desc: "Prayer, scripture reading, journaling, or a quick check-in \u2014 log your habits your way.",
    color: "var(--color-brand)",
  },
  {
    emoji: "\u{1F525}",
    title: "Streaks and milestones",
    desc: "Watch your streak grow and hit milestones that keep you motivated.",
    color: "var(--color-streak)",
  },
  {
    emoji: "\u{1F91D}",
    title: "Accountability partners",
    desc: "Share habits with friends who keep you honest and on track.",
    color: "var(--color-success)",
  },
  {
    emoji: "\u{1F4AC}",
    title: "Encouragements",
    desc: "Send messages and react to each other\u2019s updates to cheer one another on.",
    color: "var(--color-encourage)",
  },
  {
    emoji: "\u{1F4CA}",
    title: "Weekly summaries",
    desc: "Get a snapshot of your progress every week \u2014 celebrate wins, spot patterns.",
    color: "var(--color-rain)",
  },
  {
    emoji: "\u{1F4F1}",
    title: "Works offline",
    desc: "Install it as an app and track habits even without an internet connection.",
    color: "var(--color-text-secondary)",
  },
];

const STEPS = [
  {
    num: "1",
    title: "Create a habit",
    desc: "Set your schedule, pick a color, and choose how you'll complete it.",
  },
  {
    num: "2",
    title: "Invite your community",
    desc: "Add accountability partners who can see your progress and cheer you on.",
  },
  {
    num: "3",
    title: "Complete & celebrate",
    desc: "Build streaks, hit milestones, and send encouragements to spur one another on.",
  },
];

const WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/**
 * The five hours the app's colors and sky pass through, each drawn in its own
 * palette. Verses are NIV, like the fact carousel's.
 */
const HOURS = [
  { hour: 5, name: "Before dawn", time: "5:00 AM", verse: "\u201C\u2026and the bright Morning Star.\u201D", ref: "Revelation 22:16" },
  { hour: 6.5, name: "Sunrise", time: "6:30 AM", verse: "\u201CFrom the rising of the sun\u2026\u201D", ref: "Psalm 113:3" },
  { hour: 13, name: "Midday", time: "1:00 PM", verse: "\u201CLook at the birds of the air.\u201D", ref: "Matthew 6:26" },
  { hour: 19.5, name: "Dusk", time: "7:30 PM", verse: "\u201CAnd there was evening\u2026\u201D", ref: "Genesis 1:5" },
  { hour: 21.5, name: "Night", time: "9:30 PM", verse: "\u201C\u2026the moon and the stars, which you have set in place.\u201D", ref: "Psalm 8:3" },
] as const;

/* ── Page (Server Component — zero motion/react JS shipped) ── */

export default function LandingPage() {
  return (
    <div
      className="min-h-screen bg-bg-primary font-sans"
      style={{ color: "var(--color-text-primary)" }}
    >
      {/* Client island: auth redirect, scroll nav, fact carousel, scroll observer */}
      <LandingInteractive />

      {/* ── Nav ── */}
      <nav
        id="landing-nav"
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-transparent"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link
            href="/"
            className="font-display text-xl font-medium"
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
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
              <Link
                href="/auth/signup"
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                Get Started &mdash; it&apos;s free
              </Link>
              <Link
                href="#how-it-works"
                className={buttonVariants({ variant: "secondary" })}
              >
                See how it works
              </Link>
            </div>
            <p
              className="mt-10 font-display text-lg italic max-w-md mx-auto lg:mx-0"
              style={{ color: "var(--color-text-secondary)" }}
            >
              &ldquo;Your word is a lamp for my feet, a light on my path.&rdquo;
              <span className="block mt-1 not-italic font-sans text-sm" style={{ color: "var(--color-text-tertiary)" }}>
                Psalm 119:105
              </span>
            </p>
          </div>

          <div className="flex-1 max-w-sm w-full landing-hero-mockup">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ── It changes with your day: the five hours, each in its own palette ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12 landing-animate-on-scroll landing-section-header">
            <h2 className="font-display text-3xl sm:text-4xl font-medium mb-4">
              It changes with your day
            </h2>
            <p
              className="text-lg max-w-2xl mx-auto"
              style={{ color: "var(--color-text-secondary)" }}
            >
              MotiveFaith&apos;s colors and quiet sky move from before dawn to
              nightfall, so the app always feels like the hour you&apos;re in.
            </p>
          </div>

          <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-2 lg:grid lg:grid-cols-5 lg:overflow-visible lg:mx-0 lg:px-0 landing-animate-on-scroll landing-feature-list">
            {HOURS.map(({ hour, name, time, verse, ref }, i) => (
              <li
                key={name}
                className="w-64 shrink-0 snap-start lg:w-auto rounded-xl overflow-hidden border"
                // This card wears its own hour's palette, whatever the page shows.
                style={{ ...palette(hour).vars, borderColor: "var(--color-border)" } as React.CSSProperties}
              >
                <div
                  className="relative aspect-[390/220] overflow-hidden"
                  style={{ background: "linear-gradient(to bottom, var(--color-header), var(--color-bg-primary))" }}
                >
                  <SkyStarField hour={hour} idPrefix={`hours-${i}`} className="absolute inset-0 h-full w-full" />
                  <SkyBand hour={hour} idPrefix={`hours-${i}`} className="absolute inset-0 h-full w-full" />
                </div>
                <div className="p-4 h-full" style={{ background: "var(--color-bg-elevated)" }}>
                  <p className="text-xs tabular-nums" style={{ color: "var(--color-text-secondary)" }}>
                    {time}
                  </p>
                  <h3 className="font-display font-medium text-lg mb-1" style={{ color: "var(--color-text-primary)" }}>
                    {name}
                  </h3>
                  <p className="text-sm italic" style={{ color: "var(--color-text-secondary)" }}>
                    {verse}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                    {ref}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-bg-secondary">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12 landing-animate-on-scroll landing-section-header">
            <h2 className="font-display text-3xl sm:text-4xl font-medium mb-4">
              Everything you need to build better habits
            </h2>
            <p
              className="text-lg max-w-2xl mx-auto"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Simple tools, powerful results. MotiveFaith gives you everything
              to stay rooted in your disciplines.
            </p>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10 sm:gap-y-12 landing-animate-on-scroll landing-feature-list">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-4">
                <span
                  aria-hidden
                  className="shrink-0 w-11 h-11 rounded-md flex items-center justify-center text-xl"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${feature.color} 14%, var(--color-bg-elevated))`,
                  }}
                >
                  {feature.emoji}
                </span>
                <div className="pt-0.5">
                  <h3 className="font-display font-medium text-lg mb-1">
                    {feature.title}
                  </h3>
                  <p
                    className="text-sm leading-relaxed max-w-[34ch]"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {feature.desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section
        id="how-it-works"
        className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-12 landing-animate-on-scroll landing-section-header">
            <h2 className="font-display text-3xl sm:text-4xl font-medium mb-4">
              How it works
            </h2>
            <p
              style={{ color: "var(--color-text-secondary)" }}
              className="text-lg"
            >
              Three simple steps to better habits.
            </p>
          </div>

          <div className="relative">
            {/* Connecting vertical line */}
            <div
              className="absolute left-6 top-0 bottom-0 w-0.5 hidden sm:block"
              style={{ backgroundColor: "var(--color-brand-light)" }}
            />

            <div className="space-y-8">
              {STEPS.map((step, i) => (
                <div
                  key={step.num}
                  className="flex items-start gap-4 sm:gap-6 landing-animate-on-scroll landing-step"
                  style={{ animationDelay: `${i * 150}ms` }}
                >
                  <div
                    className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-mono font-bold text-lg text-on-brand relative z-10"
                    style={{ backgroundColor: "var(--color-brand)" }}
                  >
                    {step.num}
                  </div>
                  <div className="pt-2">
                    <h3 className="font-display font-medium text-lg mb-1">
                      {step.title}
                    </h3>
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Fun Fact Banner ── */}
      <section className="py-8 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl bg-brand-light rounded-lg px-6 py-5 overflow-hidden min-h-17">
          <FactCarousel />
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center landing-animate-on-scroll landing-cta">
          <h2 className="font-display text-3xl sm:text-4xl font-medium mb-4">
            Ready to build better habits?
          </h2>
          <p
            className="text-lg mb-8"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Join MotiveFaith and start your streak today.
          </p>
          <Link
            href="/auth/signup"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Get Started
          </Link>
          <p
            className="text-xs mt-4"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            No credit card required.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="py-8 px-4 sm:px-6 lg:px-8 border-t"
        style={{ borderColor: "var(--color-bg-secondary)" }}
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
            className="flex items-center gap-4 text-sm flex-wrap justify-center sm:justify-end"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <Link href="/auth/login" className="hover:underline">
              Sign in
            </Link>
            <Link href="/auth/signup" className="hover:underline">
              Sign up
            </Link>
            <span
              className="hidden sm:inline"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              |
            </span>
            <Link href="/legal/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/legal/privacy" className="hover:underline">
              Privacy
            </Link>
            <Link href="/legal/dmca" className="hover:underline">
              DMCA
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Hero Mockup (pure server markup + CSS animations) ── */

function HeroMockup() {
  return (
    <div
      className="bg-bg-elevated rounded-xl shadow-lg p-5 border"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Habit card header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-md flex items-center justify-center text-lg"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-brand) 14%, var(--color-bg-elevated))",
          }}
        >
          {"\u{1F64F}"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-medium text-sm">Morning Prayer</p>
          <p
            className="text-xs"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Every morning at 6:30 am
          </p>
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 landing-checkmark"
          style={{ backgroundColor: "var(--color-brand)", boxShadow: "var(--lamp-glow-done)" }}
        >
          <svg
            className="w-4 h-4 text-on-brand"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      </div>

      {/* Streak, drawn as the dashboard draws it: the flame in its glow */}
      <div className="flex items-center gap-2.5 mb-3">
        <span
          aria-hidden
          className="w-7 h-7 rounded-full flex items-center justify-center"
          style={{ background: "var(--lamp-halo)", color: "var(--color-streak)" }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.5c1.2 3.6 5.5 5.6 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4.4 2.7-5.5.3 1.8 1.1 2.8 2.2 3.3 0-3.3-.9-5.8.6-8.4z" />
          </svg>
        </span>
        <span className="text-sm font-medium">
          14 day streak
        </span>
      </div>

      {/* Week dots */}
      <div className="flex items-center gap-1.5">
        {WEEK_DAYS.map((day, i) => (
          <div key={`${day}-${i}`} className="flex flex-col items-center gap-1">
            <span
              className="text-[10px] font-medium"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {day}
            </span>
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center landing-dot"
              style={{
                backgroundColor:
                  i < 5 ? "var(--color-brand)" : "var(--color-bg-secondary)",
                animationDelay: `${800 + i * 100}ms`,
              }}
            >
              {i < 5 && (
                <svg
                  className="w-3 h-3 text-on-brand"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Encouragement bubble */}
      <div className="mt-4 bg-brand-light rounded-md px-3 py-2 flex items-center gap-2 landing-encourage">
        <span className="text-sm">{"\u{1F4AA}"}</span>
        <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          <span className="font-semibold">Alex</span> sent you an encouragement!
        </p>
      </div>
    </div>
  );
}
