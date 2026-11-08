import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { lateHabitStatus } from "@/lib/utils/late-habit-status";
import { lateHabitKey, type LateHabit } from "@/lib/types/late-habits";

/**
 * Habits someone could use a word about, drawn the same in a chat's card and
 * in the inbox. In a friend's chat each habit leads (LateHabitRow); where
 * several people's can appear, a group's card or the inbox, each person leads
 * once with their habits under them (PersonLateHabits), however many have
 * gone late at once.
 */

/**
 * Where it stands. The dot uses the pills' vocabulary: the flame for not
 * logged yet, with time still to log it; red for a day missed.
 */
function LateStatus({ habit, now }: { habit: LateHabit; now: Date }) {
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary">
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          habit.kind === "encourage" ? "bg-miss" : "bg-streak",
        )}
      />
      <span className="min-w-0 truncate">{lateHabitStatus(habit, now)}</span>
    </p>
  );
}

/** One habit of the friend whose chat this is: its emoji leads, in its color. */
export function LateHabitRow({ habit, now }: { habit: LateHabit; now: Date }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className="habit-tint flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-base leading-none"
        style={{ ["--habit-color" as string]: habit.color }}
      >
        {habit.emoji}
      </span>
      <div className="min-w-0 flex-1">
        {/* Two lines before it cuts: the name is what identifies it. */}
        <p className="line-clamp-2 text-sm font-medium text-text-primary">{habit.title}</p>
        <LateStatus habit={habit} now={now} />
      </div>
    </div>
  );
}

/**
 * One person's late habits, all theirs and in order, under their face and
 * name. `more` counts any left out, for a list that only previews them.
 */
export function PersonLateHabits({
  habits,
  more = 0,
  now,
}: {
  habits: LateHabit[];
  more?: number;
  now: Date;
}) {
  const [first] = habits;
  if (!first) return null;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Avatar src={first.ownerAvatar} name={first.ownerName} size="sm" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{first.ownerName}</p>
        <ul className="mt-1 space-y-2">
          {habits.map((habit) => (
            <li key={lateHabitKey(habit)}>
              <p className="line-clamp-2 text-sm text-text-primary">
                {habit.emoji} {habit.title}
              </p>
              <LateStatus habit={habit} now={now} />
            </li>
          ))}
        </ul>
        {more > 0 && <p className="mt-2 text-xs text-text-tertiary">and {more} more</p>}
      </div>
    </div>
  );
}

/** Consecutive habits of one person together, as get_chat_late_habits orders them. */
export function byPerson(habits: LateHabit[]): LateHabit[][] {
  const people: LateHabit[][] = [];
  for (const habit of habits) {
    const last = people[people.length - 1];
    if (last && last[0].ownerId === habit.ownerId) last.push(habit);
    else people.push([habit]);
  }
  return people;
}
