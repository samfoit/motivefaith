"use client";

import { Skeleton } from "@/components/ui/Skeleton";

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
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Greeting skeleton */}
        <div className="space-y-2">
          <Skeleton variant="text" width="55%" height={32} />
          <Skeleton variant="text" width="35%" height={16} />
        </div>

        {/* Progress bar skeleton */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Skeleton variant="text" width={120} height={16} />
            <Skeleton variant="text" width={32} height={16} />
          </div>
          <Skeleton variant="rect" width="100%" height={8} className="rounded-full" />
        </div>

        {/* Streak summary skeleton */}
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

        {/* Habit list skeleton */}
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
      </div>
    </div>
  );
}
