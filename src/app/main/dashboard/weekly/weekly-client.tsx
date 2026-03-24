"use client";

import React from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  Heart,
  Send,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { CalendarHeatmap } from "@/components/habits/CalendarHeatmap";
import { useWeeklySummary } from "@/lib/hooks/useWeeklySummary";

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
  index,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
  index: number;
}) {
  return (
    <motion.div
      custom={index}
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      className="rounded-lg bg-elevated p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
        >
          {icon}
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <p
        className="font-mono font-bold text-[var(--color-text-primary)]"
        style={{ fontSize: "var(--text-2xl)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">{sub}</p>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeeklySummaryClient({ userId }: { userId: string }) {
  const router = useRouter();
  const { data: summary, isLoading } = useWeeklySummary(userId);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <p className="text-sm text-[var(--color-text-secondary)]">
          No data available yet.
        </p>
      </div>
    );
  }

  const rate = Math.round(summary.completionRate);
  const delta = summary.weekDelta;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor =
    delta > 0
      ? "var(--color-success)"
      : delta < 0
        ? "var(--color-miss)"
        : "var(--color-text-tertiary)";
  const deltaText =
    delta > 0
      ? `+${delta} vs last week`
      : delta < 0
        ? `${delta} vs last week`
        : "Same as last week";

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/main/dashboard")}
            className="p-2 -ml-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-primary)]" />
          </button>
          <div>
            <h1
              className="font-display font-bold text-[var(--color-text-primary)]"
              style={{ fontSize: "var(--text-2xl)" }}
            >
              Weekly Summary
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Your last 7 days at a glance
            </p>
          </div>
        </div>

        {/* Hero: Completion Rate */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-lg bg-elevated p-6 shadow-sm text-center"
        >
          <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider font-medium mb-2">
            Completion Rate
          </p>
          <p
            className="font-display font-bold text-[var(--color-brand)]"
            style={{ fontSize: "var(--text-hero)" }}
          >
            {rate}%
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {summary.totalCompletions} of {summary.totalScheduled} scheduled
          </p>

          {/* Week comparison */}
          <div
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-sm font-medium"
            style={{
              color: deltaColor,
              backgroundColor: `color-mix(in srgb, ${deltaColor} 10%, transparent)`,
            }}
          >
            <DeltaIcon className="w-4 h-4" />
            <span>{deltaText}</span>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Completions"
            value={summary.totalCompletions}
            sub={`${summary.prevWeekCompletions} last week`}
            icon={<CheckCircle2 className="w-4 h-4" style={{ color: "var(--color-success)" }} />}
            color="var(--color-success)"
            index={0}
          />
          <StatCard
            label="Best Streak"
            value={summary.bestStreak}
            sub="days"
            icon={<Flame className="w-4 h-4" style={{ color: "var(--color-streak)" }} />}
            color="var(--color-streak)"
            index={1}
          />
          <StatCard
            label="Encouragement Sent"
            value={summary.encouragementsSent}
            icon={<Send className="w-4 h-4" style={{ color: "var(--color-encourage)" }} />}
            color="var(--color-encourage)"
            index={2}
          />
          <StatCard
            label="Received"
            value={summary.encouragementsReceived}
            icon={<Heart className="w-4 h-4" style={{ color: "var(--color-encourage)" }} />}
            color="var(--color-encourage)"
            index={3}
          />
        </div>

        {/* Most Consistent Habit */}
        {summary.mostConsistentHabit && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-lg bg-elevated p-4 shadow-sm"
          >
            <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider font-medium mb-2">
              Most Consistent
            </p>
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {summary.mostConsistentHabit.emoji}
              </span>
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">
                  {summary.mostConsistentHabit.title}
                </p>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {summary.mostConsistentHabit.count} completions this week
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Weekly Heatmap */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className={cn("rounded-lg bg-elevated p-4 shadow-sm")}
        >
          <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider font-medium mb-3">
            This Week
          </p>
          <CalendarHeatmap data={summary.dailyCompletions} days={7} />
        </motion.div>
      </div>
    </div>
  );
}
