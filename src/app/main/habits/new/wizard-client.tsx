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
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { DASHBOARD_KEY_PREFIX, dashboardKey } from "@/lib/hooks/useDashboard";
import { applyHabitCreate } from "@/lib/data/dashboard-mutations";
import type { DashboardData } from "@/lib/data/dashboard";
import { sendOrQueue } from "@/lib/offline-write";
import { useAuthUserId } from "@/lib/hooks/useAuthUserId";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  StepName,
  StepSchedule,
  StepColor,
  StepSharing,
  StepReview,
  DEFAULT_FORM,
  type HabitForm,
} from "./wizard-steps";

const SuccessScreen = dynamic(
  () => import("./wizard-steps").then((m) => m.SuccessScreen),
  { ssr: false },
);

const STEP_LABELS = ["Name", "Schedule", "Color", "Sharing", "Review"];

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

export function WizardClient() {
  // Read here rather than taken as a prop, so the page's HTML carries no user
  // data and can be cached for offline use.
  const userId = useAuthUserId();
  const router = useRouter();
  const queryClient = useQueryClient();
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
    // The session has not resolved, or is gone. Creating a habit with no owner
    // would fail RLS anyway; better to say so than to queue an unusable write.
    if (!userId) {
      showToast({ variant: "error", title: "Sign in to create a habit" });
      return;
    }
    setIsSubmitting(true);
    try {
      const supabase = createClient();

      // The id is minted here rather than by Postgres. `habits.id` is
      // `uuid DEFAULT gen_random_uuid()` and the RLS policy constrains
      // `user_id`, not `id`, so the client may choose it — and choosing it is
      // what makes a habit created offline work at all: it has a real id
      // immediately, so completions logged against it are valid, and a replay
      // that was interrupted mid-flight collides on the primary key instead of
      // creating the habit twice.
      const habitId = crypto.randomUUID();
      const habitRow = {
        id: habitId,
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
        is_shared: form.isShared,
      };

      const result = await sendOrQueue(
        {
          id: habitId,
          kind: "habit.create",
          userId,
          payload: {
            habit: habitRow,
            friendIds: form.selectedFriends,
            groupIds: form.selectedGroups,
          },
        },
        async () => {
          const { error } = await supabase.from("habits").insert(habitRow);
          if (error) throw error;

          // Insert habit_shares for selected friends
          if (form.selectedFriends.length > 0) {
            const { error: shareError } = await supabase
              .from("habit_shares")
              .insert(
                form.selectedFriends.map((friendId) => ({
                  habit_id: habitId,
                  shared_with: friendId,
                })),
              );

            if (shareError) {
              showToast({ variant: "error", title: "Habit created, but sharing with friends failed" });
            }
          }

          // Insert group_habit_shares for selected groups
          if (form.selectedGroups.length > 0) {
            const { error: groupShareError } = await supabase
              .from("group_habit_shares")
              .insert(
                form.selectedGroups.map((groupId) => ({
                  group_id: groupId,
                  habit_id: habitId,
                  shared_by: userId,
                })),
              );

            if (groupShareError) {
              showToast({ variant: "error", title: "Habit created, but sharing with groups failed" });
            }
          }
          return { queued: false as const };
        },
      );

      if ("queued" in result && result.queued) {
        // Put it on the dashboard now. Offline there is nothing to refetch, so
        // without this the user would land on the dashboard and not see the
        // habit they just created.
        queryClient.setQueryData<DashboardData>(dashboardKey(userId), (old) =>
          applyHabitCreate(old, habitRow),
        );
        showToast({
          variant: "success",
          title: "Saved offline",
          description: "This habit will sync when you reconnect.",
        });
      }

      // Drop the cached dashboard so the new habit is there when we land on
      // it. router.refresh() no longer does anything for the dashboard — its
      // data is client-side now.
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY_PREFIX });
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
              {step === 2 && <StepColor form={form} update={update} />}
              {step === 3 && (
                <StepSharing form={form} update={update} userId={userId ?? ""} />
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
