import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

/**
 * The dashboard's loading geometry, in one place.
 *
 * Shared by the route's `loading.tsx` and by `DashboardClient`'s own pending
 * state. They must not drift: the dashboard's CLS is 0.0000 and the way to
 * keep it there is for every placeholder box to match the box that replaces
 * it. Two hand-maintained copies is how DIAGNOSIS R3's four disagreeing
 * skeletons happened.
 *
 * Boxes match what `DayView` actually renders:
 *   view toggle (day/week/month)              → 40px pill
 *   "Today's progress" + count + bar          → 16px row + 8px bar
 *   "Active Streaks" + horizontal cards       → 16px label + 48px cards
 *   time-group heading + habit cards          → 16px label + 76px cards
 */
function HabitCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-[var(--color-bg-elevated)] p-4 shadow-sm border border-[var(--color-bg-secondary)]">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton variant="circle" width={28} height={28} />
          <Skeleton variant="text" width="60%" height={20} />
        </div>
        <Skeleton variant="text" width="40%" height={14} />
      </div>
      <Skeleton variant="circle" width={40} height={40} />
    </div>
  );
}

/** Everything below the greeting. */
export function DashboardContentSkeleton() {
  return (
    <>
      {/* View toggle */}
      <Skeleton variant="rect" width="100%" height={40} className="rounded-lg" />

      {/* Today's progress */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton variant="text" width={120} height={16} />
          <Skeleton variant="text" width={32} height={16} />
        </div>
        <Skeleton variant="rect" width="100%" height={8} className="rounded-full" />
      </div>

      {/* Active streaks */}
      <div className="space-y-3">
        <Skeleton variant="text" width={100} height={16} />
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              variant="rect"
              width={140}
              height={48}
              className="rounded-lg flex-shrink-0"
            />
          ))}
        </div>
      </div>

      {/* Habit groups */}
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton variant="text" width={80} height={16} />
          <HabitCardSkeleton />
          <HabitCardSkeleton />
        </div>
        <div className="space-y-3">
          <Skeleton variant="text" width={80} height={16} />
          <HabitCardSkeleton />
        </div>
      </div>
    </>
  );
}

/** The whole screen, greeting included — for the route-level `loading.tsx`. */
export function DashboardSkeleton() {
  return (
    <SkeletonScreen
      label="Loading your habits"
      className="max-w-2xl mx-auto px-4 pt-4 space-y-4 sm:pt-6 sm:space-y-6"
    >
      {/* Greeting + new-habit button — the same 3.25rem the live header
          reserves, so the swap moves nothing below it. */}
      <div className="flex items-center justify-between min-h-[3.25rem]">
        <div className="space-y-2 flex-1">
          <Skeleton variant="text" width="55%" height={32} />
          <Skeleton variant="text" width="35%" height={16} />
        </div>
        <Skeleton variant="circle" width={36} height={36} />
      </div>
      <DashboardContentSkeleton />
    </SkeletonScreen>
  );
}
