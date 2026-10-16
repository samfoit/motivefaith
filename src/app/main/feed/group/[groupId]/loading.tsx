"use client";

import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

export default function GroupTimelineLoading() {
  return (
    <div className="min-h-screen">
      <SkeletonScreen label="Loading group" className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        {/* Today's shared habits: one line of chips */}
        <div className="flex items-center gap-2">
          {[112, 96, 128].map((w) => (
            <Skeleton
              key={w}
              variant="rect"
              width={w}
              height={30}
              className="rounded-full shrink-0"
            />
          ))}
        </div>
        {/* Timeline items */}
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg bg-elevated p-4 shadow-sm">
              <Skeleton variant="circle" width={36} height={36} />
              <div className="flex-1 space-y-2">
                <Skeleton variant="text" width="50%" height={16} />
                <Skeleton variant="text" width="70%" height={14} />
                <Skeleton variant="text" width="30%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </SkeletonScreen>
    </div>
  );
}
