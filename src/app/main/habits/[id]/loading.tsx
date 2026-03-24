"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function HabitDetailLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Back button + title */}
        <div className="flex items-center gap-3">
          <Skeleton variant="circle" width={32} height={32} />
          <div className="space-y-1 flex-1">
            <Skeleton variant="text" width="50%" height={24} />
            <Skeleton variant="text" width="30%" height={14} />
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              variant="rect"
              width="33%"
              height={72}
              className="rounded-xl flex-1"
            />
          ))}
        </div>

        {/* Heatmap area */}
        <Skeleton variant="rect" width="100%" height={160} className="rounded-xl" />

        {/* Recent completions */}
        <div className="space-y-3">
          <Skeleton variant="text" width={140} height={16} />
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              variant="rect"
              width="100%"
              height={64}
              className="rounded-lg"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
