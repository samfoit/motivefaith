import type { Database } from "@/lib/supabase/types";

export type HabitFrequency = Database["public"]["Enums"]["habit_frequency"];

export const HABIT_EMOJIS = [
  "✅",
  "🏃",
  "📚",
  "💪",
  "🧘",
  "💧",
  "🎯",
  "📝",
  "🎨",
  "🎵",
  "🌱",
  "😴",
  "🍎",
  "💊",
  "🧹",
  "🐕",
  "☀️",
  "🧠",
  "💰",
  "📱",
  "🏋️",
  "🚶",
  "🎸",
  "✍️",
  "🥗",
  "📖",
  "🗣️",
  "💻",
  "🌿",
  "🏊",
  "✝️",
  "🙏",
];

export const FREQUENCIES: {
  value: HabitFrequency;
  label: string;
  days: number[] | null;
}[] = [
  { value: "daily", label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  {
    value: "weeksdays",
    label: "Weekdays",
    days: [1, 2, 3, 4, 5],
  },
  { value: "weekends", label: "Weekends", days: [0, 6] },
  { value: "specific_days", label: "Custom", days: null },
  { value: "weekly", label: "Weekly", days: [0, 1, 2, 3, 4, 5, 6] },
];

export const DAYS = [
  { value: 0, label: "S", full: "Sunday" },
  { value: 1, label: "M", full: "Monday" },
  { value: 2, label: "T", full: "Tuesday" },
  { value: 3, label: "W", full: "Wednesday" },
  { value: 4, label: "T", full: "Thursday" },
  { value: 5, label: "F", full: "Friday" },
  { value: 6, label: "S", full: "Saturday" },
];

export const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  weeksdays: "Weekdays",
  weekends: "Weekends",
  specific_days: "Custom days",
  weekly: "Weekly",
};
