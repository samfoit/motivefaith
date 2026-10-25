"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTopBarBack } from "@/components/layout/TopBarSlots";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";
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

const STEP_LABELS = ["Name", "Schedule", "Color", "Partners", "Review"];

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

  // Each step starts at the top. Without this a step reached by scrolling
  // down to Next opened mid-page, with its heading out of view.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

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

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // The bar's arrow steps back through the wizard; on the first step it
  // leaves the page as usual.
  useTopBarBack(step > 0 ? goBack : null);

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
        visibility: form.visibility,
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

          // Invite the chosen friends. Each lands as a pending invitation
          // they can accept or decline — nobody is subscribed to a habit they
          // did not agree to watch.
          if (form.selectedFriends.length > 0) {
            const results = await Promise.all(
              form.selectedFriends.map((friendId) =>
                untypedRpc(supabase, "invite_habit_partner", {
                  p_habit_id: habitId,
                  p_user_id: friendId,
                }),
              ),
            );

            if (results.some((r) => r.error)) {
              showToast({ variant: "error", title: "Habit created, but some invites failed" });
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
    <div>
      <div className="max-w-lg mx-auto px-4 pt-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`h-1.5 rounded-full flex-1 transition-colors duration-300 ${
                  i <= step ? "bg-brand" : "bg-[var(--color-surface-hover)]"
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="relative overflow-hidden -mx-1 px-1">
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

        {/* Navigation buttons. Pinned just above the bottom nav, so Next is
            in reach on a long step without scrolling for it. */}
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-6 flex items-center gap-3 border-t border-border bg-[var(--color-bg-primary)] px-4 py-3">
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
