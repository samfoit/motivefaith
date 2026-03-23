"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function GroupTimelineLoading() {
  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        {/* Group header */}
        <div className="flex items-center gap-3">
          <Skeleton variant="circle" width={48} height={48} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="40%" height={20} />
            <Skeleton variant="text" width="25%" height={14} />
          </div>
        </div>
        {/* Tab bar */}
        <Skeleton variant="rect" width="100%" height={40} className="rounded-lg" />
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
      </div>
    </div>
  );
}
