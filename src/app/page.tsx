import Link from "next/link";
import { LandingInteractive, FactCarousel } from "./landing-client";
import { Container } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-static";

/* ── Data ─────────────────────────────────────────────────── */

const FEATURES = [
  {
    emoji: "\u{1F64F}",
    title: "Track Any Habit",
    desc: "Prayer, scripture reading, journaling, or a quick check-in \u2014 log your habits your way.",
    color: "#8b5cf6",
  },
  {
    emoji: "\u{1F525}",
    title: "Streak Tracking",
    desc: "Watch your streak grow and hit milestones that keep you motivated",
    color: "#f59e0b",
  },
  {
    emoji: "\u{1F91D}",
    title: "Accountability Partners",
    desc: "Share habits with friends who keep you honest and on track.",
    color: "#f59e0b",
  },
  {
    emoji: "\u{1F4AC}",
    title: "Encouragements",
    desc: "Send messages and react to eachothers updates to cheer each other on.",
    color: "#8b5cf6",
  },
  {
    emoji: "\u{1F4CA}",
    title: "Weekly Summaries",
    desc: "Get a snapshot of your progress every week \u2014 celebrate wins, spot patterns.",
    color: "#3b82f6",
  },
  {
    emoji: "\u{1F4F1}",
    title: "Works Offline",
    desc: "Install as an app and track habits even without an internet connection.",
    color: "#22c55e",
  },
];

const STEPS = [
  {
    num: "1",
    title: "Create a habit",
    desc: "Set your schedule, pick a category, and choose how you'll complete it.",
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
            className="font-display text-xl font-bold"
            style={{ color: "var(--color-brand)" }}
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

      {/* ── Hero ── */}
      <section className="pt-32 pb-16 sm:pt-40 sm:pb-24 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          <div className="flex-1 text-center lg:text-left landing-hero-text">
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight mb-6">
              Build habits that stick.{" "}
              <span style={{ color: "var(--color-brand)" }}>Together.</span>
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
          </div>

          <div className="flex-1 max-w-sm w-full landing-hero-mockup">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-bg-secondary">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12 landing-animate-on-scroll landing-section-header">
            <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {FEATURES.map((feature, i) => (
              <div
                key={feature.title}
                className="landing-animate-on-scroll landing-feature-card"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <Container
                  hoverLift
                  className="h-full border-l-[3px]"
                  style={{ borderLeftColor: feature.color }}
                >
                  <span className="text-2xl mb-3 block">{feature.emoji}</span>
                  <h3 className="font-display font-semibold text-lg mb-1">
                    {feature.title}
                  </h3>
                  <p
                    className="text-sm"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {feature.desc}
                  </p>
                </Container>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section
        id="how-it-works"
        className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-12 landing-animate-on-scroll landing-section-header">
            <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
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
                    className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-mono font-bold text-lg text-white relative z-10"
                    style={{ backgroundColor: "var(--color-brand)" }}
                  >
                    {step.num}
                  </div>
                  <div className="pt-2">
                    <h3 className="font-display font-semibold text-lg mb-1">
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
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
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
              className="font-display font-bold"
              style={{ color: "var(--color-brand)" }}
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
      className="bg-bg-elevated rounded-lg shadow-lg p-5 border"
      style={{ borderColor: "var(--color-bg-secondary)" }}
    >
      {/* Habit card header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-md flex items-center justify-center text-lg"
          style={{ backgroundColor: "var(--cat-spiritual)", color: "white" }}
        >
          {"\u{1F64F}"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-sm">Morning Prayer</p>
          <p
            className="text-xs"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Every morning at 6:30 am
          </p>
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 landing-checkmark"
          style={{ backgroundColor: "var(--color-success)" }}
        >
          <svg
            className="w-4 h-4 text-white"
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

      {/* Streak */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{"\u{1F525}"}</span>
        <span
          className="font-mono font-bold text-sm"
          style={{ color: "var(--color-streak)" }}
        >
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
                  i < 5 ? "var(--color-success)" : "var(--color-bg-secondary)",
                animationDelay: `${800 + i * 100}ms`,
              }}
            >
              {i < 5 && (
                <svg
                  className="w-3 h-3 text-white"
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
