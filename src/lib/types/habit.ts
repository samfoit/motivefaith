import type { Tables } from "@/lib/supabase/types";

/**
 * A habit as the app sees it.
 *
 * `habits.category` still exists in the database but nothing reads or writes
 * it any more — habits have no category, type or tag, and color is chosen
 * directly. Omitting it here keeps the column from leaking back into the UI
 * through the generated row type.
 */
export type Habit = Omit<Tables<"habits">, "category">;

/**
 * How a habit card should explain a moved rain check. At most one field is
 * set: `movedTo` on the day the habit was rain-checked away from, `movedFrom`
 * on the day it landed. Both are spelled-out weekday names.
 */
export interface MoveLabels {
  movedTo: string | null;
  movedFrom: string | null;
}
