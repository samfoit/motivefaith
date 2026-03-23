"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

const HABIT_FACTS = [
  {
    emoji: "📖",
    fact: "'As iron sharpens iron, so one person sharpens another.'",
    source: "Proverbs 27:17 (NIV)",
  },
  {
    emoji: "🧠",
    fact: "It takes an average of 66 days to form a new habit — spiritual disciplines are no different. Patience and persistence pay off.",
    source: "European Journal of Social Psychology",
  },
  {
    emoji: "🙏",
    fact: "'Devote yourselves to prayer, being watchful and thankful.' Consistency in prayer transforms your relationship with God.",
    source: "Colossians 4:2 (NIV)",
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
    emoji: "✝️",
    fact: "'Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.'",
    source: "Galatians 6:9 (NIV)",
  },
  {
    emoji: "🌅",
    fact: "'Jesus answered, “It is written: ‘Man shall not live on bread alone, but on every word that comes from the mouth of God.’”",
    source: "Matthew 4:4 (NIV)",
  },
  {
    emoji: "📱",
    fact: "Simply tracking a habit makes you 40% more likely to stick with it. Even tracking your quiet time helps.",
    source: "British Journal of Health Psychology",
  },
  {
    emoji: "⚡",
    fact: "The 2-minute rule: start any discipline with just 2 minutes. A short prayer is better than no prayer.",
    source: "James Clear, Atomic Habits",
  },
  {
    emoji: "🪞",
    fact: "'I am a person of prayer' beats 'I want to pray more' every time. Identity-based habits stick longer.",
    source: "James Clear, Atomic Habits",
  },
];

function useCyclingFact(intervalMs: number) {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * HABIT_FACTS.length),
  );

  const advance = useCallback(() => {
    setIndex((prev) => (prev + 1) % HABIT_FACTS.length);
  }, []);

  useEffect(() => {
    const timer = setInterval(advance, intervalMs);
    return () => clearInterval(timer);
  }, [advance, intervalMs]);

  return HABIT_FACTS[index];
}

function FactCard({
  emoji,
  fact,
  source,
}: {
  emoji: string;
  fact: string;
  source: string;
}) {
  return (
    <motion.div
      key={fact}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="bg-bg-elevated/60 backdrop-blur-sm rounded-lg p-5 border border-white/10"
    >
      <span className="text-2xl mb-2 block">{emoji}</span>
      <p className="text-sm leading-relaxed mb-2 text-text-primary">{fact}</p>
      <p className="text-xs italic text-text-tertiary">— {source}</p>
    </motion.div>
  );
}

export function DesktopFactsPanel() {
  const currentFact = useCyclingFact(6000);

  return (
    <div className="hidden lg:flex flex-col justify-center w-full max-w-md xl:max-w-lg px-8">
      <div className="mb-6">
        <h2 className="font-display text-xl font-bold mb-1 text-text-primary">
          Did you know?
        </h2>
        <p className="text-sm text-text-secondary">
          The science and scripture behind spiritual growth
        </p>
      </div>

      <AnimatePresence mode="wait">
        <FactCard
          key={currentFact.fact}
          emoji={currentFact.emoji}
          fact={currentFact.fact}
          source={currentFact.source}
        />
      </AnimatePresence>
    </div>
  );
}

export function MobileFactBanner() {
  const currentFact = useCyclingFact(5000);

  return (
    <div className="lg:hidden w-full max-w-sm mb-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentFact.fact}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="bg-brand-light rounded-lg px-4 py-3 flex items-start gap-3"
        >
          <span className="text-lg shrink-0 mt-0.5">{currentFact.emoji}</span>
          <p className="text-xs leading-relaxed text-text-secondary">
            {currentFact.fact}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
