import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

/**
 * The single loading state for the dashboard.
 *
 * Geometry is matched to what `page.tsx` + `DayView` actually render, box for
 * box, so the swap to real content shifts nothing:
 *
 *   greeting (h1 at --text-2xl + date line)  → 32px + 16px
 *   "new habit" button                       → 36px circle (w-9 h-9)
 *   view toggle (day/week/month)             → 40px pill
 *   "Today's progress" + count + bar         → 16px row + 8px bar
 *   "Active Streaks" + horizontal cards      → 16px label + 48px cards
 *   time-group heading + habit cards         → 16px label + 76px cards
 *
 * Previously this screen advertised a streak row and two habit groups while
 * the page's own fallback advertised a view toggle and three cards, so the two
 * disagreed with each other and with the real page.
 */
function HabitCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm border-l-[3px] border-gray-200">
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

export default function DashboardLoading() {
  return (
    <div className="min-h-screen">
      <SkeletonScreen
        label="Loading your habits"
        className="max-w-2xl mx-auto px-4 pt-6 space-y-6"
      >
        {/* Greeting + new-habit button */}
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton variant="text" width="55%" height={32} />
            <Skeleton variant="text" width="35%" height={16} />
          </div>
          <Skeleton variant="circle" width={36} height={36} />
        </div>

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
      </SkeletonScreen>
    </div>
  );
}
