"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type HabitFrequency = Database["public"]["Enums"]["habit_frequency"];

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a challenge + optionally auto-join the creator */
export function useCreateChallenge() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupId,
      createdBy,
      title,
      emoji,
      description,
      color,
      frequency,
      schedule,
      startDate,
      endDate,
      autoJoin,
    }: {
      groupId: string;
      createdBy: string;
      title: string;
      emoji?: string;
      description?: string;
      color?: string | null;
      frequency: HabitFrequency;
      schedule: { days: number[] };
      startDate: string;
      endDate?: string;
      autoJoin?: boolean;
    }) => {
      const { data: challenge, error } = await supabase
        .from("group_challenges")
        .insert({
          group_id: groupId,
          created_by: createdBy,
          title,
          emoji: emoji || "🎯",
          description: description || null,
          color: color ?? null,
          frequency,
          schedule,
          start_date: startDate,
          end_date: endDate || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-join: create personal habit + participant row
      if (autoJoin) {
        const { data: habit, error: habitErr } = await supabase
          .from("habits")
          .insert({
            user_id: createdBy,
            title,
            emoji: emoji || "🎯",
            color: color ?? null,
              frequency,
            schedule,
          })
          .select("id")
          .single();

        if (habitErr) throw habitErr;

        await supabase
          .from("group_challenge_participants")
          .insert({
            challenge_id: challenge.id,
            user_id: createdBy,
            habit_id: habit.id,
          });
      }

      return challenge;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Join a challenge — creates a personal habit from the template */
export function useJoinChallenge() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      challengeId,
      userId,
      title,
      emoji,
      color,
      frequency,
      schedule,
    }: {
      challengeId: string;
      userId: string;
      title: string;
      emoji: string;
      color: string | null;
      frequency: HabitFrequency;
      schedule: { days: number[] };
    }) => {
      // Create personal habit
      const { data: habit, error: habitErr } = await supabase
        .from("habits")
        .insert({
          user_id: userId,
          title,
          emoji,
          color,
          frequency,
          schedule,
        })
        .select("id")
        .single();

      if (habitErr) throw habitErr;

      // Join as participant
      const { error } = await supabase
        .from("group_challenge_participants")
        .insert({
          challenge_id: challengeId,
          user_id: userId,
          habit_id: habit.id,
        });

      if (error) throw error;
      return { habitId: habit.id };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}

/** Leave a challenge */
export function useLeaveChallenge() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      challengeId,
      userId,
    }: {
      challengeId: string;
      userId: string;
    }) => {
      const { error } = await supabase
        .from("group_challenge_participants")
        .delete()
        .eq("challenge_id", challengeId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", "list"] });
      queryClient.invalidateQueries({ queryKey: ["groups", "detail"] });
    },
  });
}
