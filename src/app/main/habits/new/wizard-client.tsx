"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  StepName,
  StepSchedule,
  StepCategory,
  StepSharing,
  StepReview,
  DEFAULT_FORM,
  type HabitForm,
} from "./wizard-steps";

const SuccessScreen = dynamic(
  () => import("./wizard-steps").then((m) => m.SuccessScreen),
  { ssr: false },
);

const STEP_LABELS = ["Name", "Schedule", "Category", "Sharing", "Review"];

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

// ---------------------------------------------------------------------------
// Wizard component
// ---------------------------------------------------------------------------

export function WizardClient({ userId }: { userId: string }) {
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [form, setForm] = useState<HabitForm>(DEFAULT_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const update = useCallback(
    <K extends keyof HabitForm>(key: K, value: HabitForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const canAdvance = (): boolean => {
    if (step === 0) return form.title.trim().length > 0;
    if (step === 1) return form.scheduleDays.length > 0;
    return true;
  };

  const goNext = () => {
    if (!canAdvance()) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  };

  const goBack = () => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data: habit, error } = await supabase
        .from("habits")
        .insert({
          user_id: userId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          emoji: form.emoji,
          color: form.color,
          frequency: form.frequency,
          schedule: { days: form.scheduleDays },
          time_window: form.timeWindowEnabled
            ? { start: form.timeWindowStart, end: form.timeWindowEnd }
            : null,
          category: form.category,
          is_shared: form.isShared,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Insert habit_shares for selected friends
      if (form.selectedFriends.length > 0 && habit) {
        const { error: shareError } = await supabase
          .from("habit_shares")
          .insert(
            form.selectedFriends.map((friendId) => ({
              habit_id: habit.id,
              shared_with: friendId,
            })),
          );

        if (shareError) {
          showToast({ variant: "error", title: "Habit created, but sharing with friends failed" });
        }
      }

      // Insert group_habit_shares for selected groups
      if (form.selectedGroups.length > 0 && habit) {
        const { error: groupShareError } = await supabase
          .from("group_habit_shares")
          .insert(
            form.selectedGroups.map((groupId) => ({
              group_id: groupId,
              habit_id: habit.id,
              shared_by: userId,
            })),
          );

        if (groupShareError) {
          showToast({ variant: "error", title: "Habit created, but sharing with groups failed" });
        }
      }

      setShowSuccess(true);
      setTimeout(() => router.push("/main/dashboard"), 1500);
    } catch (err) {
      console.error("Failed to create habit:", err);
      showToast({ variant: "error", title: "Failed to create habit" });
      setIsSubmitting(false);
    }
  };

  // --- Render ---

  if (showSuccess) {
    return <SuccessScreen form={form} />;
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => (step === 0 ? router.back() : goBack())}
            className="p-2 -ml-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </button>
          <h1
            className="font-display font-bold text-[var(--color-text-primary)]"
            style={{ fontSize: "var(--text-xl)" }}
          >
            New Habit
          </h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`h-1.5 rounded-full flex-1 transition-colors duration-300 ${
                  i <= step ? "bg-brand" : "bg-[var(--color-bg-secondary)]"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="relative overflow-hidden min-h-[420px] -mx-1 px-1">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] as const }}
            >
              {step === 0 && <StepName form={form} update={update} />}
              {step === 1 && <StepSchedule form={form} update={update} />}
              {step === 2 && <StepCategory form={form} update={update} />}
              {step === 3 && (
                <StepSharing form={form} update={update} userId={userId} />
              )}
              {step === 4 && <StepReview form={form} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-3 mt-8">
          {step > 0 && (
            <Button variant="secondary" onClick={goBack} className="flex-1">
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </Button>
          )}

          {step < STEP_LABELS.length - 1 ? (
            <Button
              onClick={goNext}
              disabled={!canAdvance()}
              className="flex-1"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={isSubmitting}
              className="flex-1"
              size="lg"
            >
              <Sparkles className="w-4 h-4" />
              <span>Create Habit</span>
            </Button>
          )}
        </div>
      </div>
      {ToastElements}
    </div>
  );
}
