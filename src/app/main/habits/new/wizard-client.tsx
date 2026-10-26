"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
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
import { useFriendsList } from "@/lib/hooks/useFriends";
import { useGroupsList } from "@/lib/hooks/useGroups";
import { cn } from "@/lib/utils/cn";
import { buildTimeWindow, timeWindowsInOrder } from "@/lib/utils/schedule";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  HabitFields,
  LiveHabitCard,
  PRIMARY_ACTION,
  PRIMARY_ACTION_UNAVAILABLE,
} from "@/components/habits/HabitFields";
import { StepPartners, DEFAULT_FORM, type HabitForm } from "./wizard-steps";

const SuccessScreen = dynamic(
  () => import("./wizard-steps").then((m) => m.SuccessScreen),
  { ssr: false },
);

/**
 * Two steps: the habit, then the people. It used to be five — name,
 * schedule, color, partners, review — three of them a single control on an
 * otherwise empty screen, and the review a copy of what the card already
 * showed. Only the name is required; everything else has a default, so the
 * first step shows each default and opens it only when touched.
 */
const STEPS = ["Habit", "Partners"] as const;

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

  const change = useCallback((patch: Partial<HabitForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // Partners are on the second step, but their lists load now, so that step
  // opens on the people rather than a spinner. Same queries, same cache.
  useFriendsList(userId ?? undefined);
  useGroupsList(userId ?? undefined);

  // The card stays editable on both steps, so the name is checked on both.
  const named = form.title.trim().length > 0;
  const canAdvance = named && form.scheduleDays.length > 0 && timeWindowsInOrder(form);

  const goNext = () => {
    if (!canAdvance) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // The bar's arrow steps back through the wizard; on the first step it
  // leaves the page as usual.
  useTopBarBack(step > 0 ? goBack : null);

  const handleSubmit = async () => {
    if (!canAdvance) return;
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
        time_window: buildTimeWindow(form),
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
    // Every animation here answers a tap; with reduced motion they cut.
    <MotionConfig reducedMotion="user">
      <div className="max-w-lg mx-auto px-4 pt-4">
        <StepIndicator step={step} />

        {/* The same card and fields as the edit sheet's. The card stays
            put while the steps change under it — the habit is the constant,
            and each step is a question about it. */}
        <LiveHabitCard form={form} onChange={change} autoFocus />

        {/* Only the questions slide; the card above them stays. Clipped
            sideways only, for the slide; -mx-1/px-1 keep selection rings at
            the edges from being sliced by it. */}
        <div className="relative overflow-x-clip -mx-1 px-1 mt-6">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] as const }}
            >
              {step === 0 ? (
                <HabitFields form={form} onChange={change} />
              ) : (
                <StepPartners form={form} onChange={change} userId={userId ?? ""} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* No Back button: the bar's arrow steps back through the wizard. */}
        <ActionBar>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={goNext}
              disabled={!canAdvance}
              size="lg"
              className={cn(PRIMARY_ACTION, !canAdvance && PRIMARY_ACTION_UNAVAILABLE)}
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={isSubmitting || !canAdvance}
              size="lg"
              className={cn(PRIMARY_ACTION, !canAdvance && PRIMARY_ACTION_UNAVAILABLE)}
            >
              Create habit
            </Button>
          )}
        </ActionBar>
      </div>
      {ToastElements}
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

/** Two named steps, so the first says what comes after it. */
function StepIndicator({ step }: { step: number }) {
  return (
    <ol aria-label="Steps" className="grid grid-cols-2 gap-2 mb-4">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? "step" : undefined}>
          <div
            className={cn(
              "h-1 rounded-full transition-colors duration-300",
              i <= step ? "bg-brand" : "bg-surface-hover",
            )}
          />
          <p
            className={cn(
              "mt-1.5 text-xs font-medium transition-colors duration-300",
              i === step ? "text-text-primary" : "text-text-tertiary",
            )}
          >
            {label}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

/**
 * The primary button, held just above the bottom nav so it is in reach on a
 * long step without scrolling for it.
 *
 * It only looks like a bar while it is one: with content scrolling beneath
 * it, it takes the ground and a hairline; at the end of the step it is just
 * the button after the last row. A full-width rule and slab floating halfway
 * down a short step was what made the short steps look broken.
 */
function ActionBar({ children }: { children: ReactNode }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    // The end of the step, seen above the nav (4rem), means nothing is
    // underneath the bar.
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: "0px 0px -64px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        className={cn(
          "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-6 px-4 py-3",
          "border-t transition-colors duration-200",
          stuck
            ? "border-border bg-[var(--color-bg-primary)]"
            : "border-transparent",
        )}
      >
        {children}
      </div>
      <div ref={endRef} aria-hidden className="h-px" />
    </>
  );
}
