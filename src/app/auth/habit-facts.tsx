"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

const HABIT_FACTS = [
  {
    emoji: "📖",
    fact: "'As iron sharpens iron, so one person sharpens another.'",
    source: "Proverbs 27:17 (NIV)",
  },
  {
    emoji: "🧠",
    fact: "It takes an average of 66 days to form a new habit. Patience and persistence pay off.",
    source: "European Journal of Social Psychology",
  },
  {
    emoji: "🤝",
    fact: "People who share their goals with a friend are 65% more likely to complete them. That's the power of fellowship.",
    source: "American Society of Training & Development",
  },
  {
    emoji: "🔥",
    fact: "Streak motivation is real: people are 2.4x more likely to act when they have an active streak.",
    source: "Duolingo Research",
  },
  {
    emoji: "📱",
    fact: "Simply tracking a habit makes you 40% more likely to stick with it.",
    source: "British Journal of Health Psychology",
  },
  {
    emoji: "⚡",
    fact: "The 2-minute rule: start any discipline with just 2 minutes then stop when the time is up. Doing this reinforces the most critical part of habit formation: showing up.",
    source: "James Clear, Atomic Habits",
  },
  {
    emoji: "🪞",
    fact: "'I am a person of prayer' beats 'I want to pray more' every time. Identity-based habits stick longer.",
    source: "James Clear, Atomic Habits",
  },
];

function useCyclingFact(intervalMs: number) {
  // The first fact is deterministic so the server and the client agree on it.
  //
  // This used to randomise in the useState initializer, which ran during SSR
  // too, so the two picked different facts. React never warned — `FactCard` is
  // keyed by the fact text, so it silently remounted instead of reporting a
  // text mismatch — but the user saw it: measured on 5/5 loads, the server's
  // fact was on screen from ~600ms and swapped for a different one at ~2310ms,
  // roughly 1.7s after first paint.
  //
  // Variety is preserved by offsetting the rotation on its first tick instead,
  // which happens a full interval after paint and is indistinguishable from
  // the normal cycling.
  const [index, setIndex] = useState(0);
  const offsetApplied = useRef(false);

  const advance = useCallback(() => {
    setIndex((prev) => {
      if (!offsetApplied.current) {
        offsetApplied.current = true;
        return Math.floor(Math.random() * HABIT_FACTS.length);
      }
      return (prev + 1) % HABIT_FACTS.length;
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(advance, intervalMs);
    return () => clearInterval(timer);
  }, [advance, intervalMs]);

  return HABIT_FACTS[index];
}

type Fact = (typeof HABIT_FACTS)[number];

/**
 * One fact and where it comes from, on the same solid card surface as the
 * auth form beside it, so it takes the hour's colors with the rest of the
 * page: Page White by day, Night Card by night. (It used to be a translucent
 * glass card on desktop and an Amber Wash banner on phones, which at night
 * read as a muddy brown box under a blue-black card, and the phone banner
 * dropped the source.)
 *
 * Facts swap with a short rise; under reduced motion they only crossfade.
 */
function FactCard({ fact, size }: { fact: Fact; size: "sm" | "lg" }) {
  const reduceMotion = useReducedMotion();
  const rise = reduceMotion ? 0 : size === "lg" ? 16 : 8;
  const lg = size === "lg";

  return (
    <motion.figure
      key={fact.fact}
      initial={{ opacity: 0, y: rise }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -rise }}
      transition={{ duration: lg ? 0.4 : 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={
        lg
          ? "bg-bg-elevated border border-border rounded-lg shadow-sm p-5"
          : "bg-bg-elevated border border-border rounded-lg shadow-sm px-4 py-3 flex items-start gap-3"
      }
    >
      <span
        aria-hidden="true"
        className={lg ? "text-2xl mb-2 block" : "text-lg leading-6 shrink-0"}
      >
        {fact.emoji}
      </span>
      <div className="min-w-0">
        <blockquote
          className={
            lg
              ? "text-sm leading-relaxed text-text-primary"
              : "text-sm leading-snug text-text-primary"
          }
        >
          <p>{fact.fact}</p>
        </blockquote>
        <figcaption className={lg ? "mt-2 text-xs text-text-tertiary" : "mt-1 text-xs text-text-tertiary"}>
          {fact.source}
        </figcaption>
      </div>
    </motion.figure>
  );
}

export function DesktopFactsPanel() {
  const currentFact = useCyclingFact(6000);

  return (
    <div className="hidden lg:flex flex-col justify-center w-full max-w-md xl:max-w-lg px-8">
      <div className="mb-6">
        <h2 className="font-display text-xl font-medium mb-1 text-text-primary">
          Did you know?
        </h2>
        <p className="text-sm text-text-secondary">
          The science and scripture behind spiritual growth
        </p>
      </div>

      <AnimatePresence mode="wait">
        <FactCard key={currentFact.fact} fact={currentFact} size="lg" />
      </AnimatePresence>
    </div>
  );
}

/**
 * Goes below the auth card, not above it: a fact of a different length
 * reflows everything under it every few seconds, and above the card that
 * would be the field being typed in.
 */
export function MobileFactBanner() {
  const currentFact = useCyclingFact(5000);

  return (
    <div className="lg:hidden w-full max-w-sm mt-4">
      <AnimatePresence mode="wait">
        <FactCard key={currentFact.fact} fact={currentFact} size="sm" />
      </AnimatePresence>
    </div>
  );
}
