"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function NewHabitLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        <Skeleton variant="text" width="40%" height={32} />
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton variant="text" width={80} height={14} />
            <Skeleton variant="rect" width="100%" height={44} className="rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton variant="text" width={80} height={14} />
            <Skeleton variant="rect" width="100%" height={44} className="rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton variant="text" width={100} height={14} />
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} variant="circle" width={40} height={40} />
              ))}
            </div>
          </div>
          <Skeleton variant="rect" width="100%" height={48} className="rounded-lg" />
        </div>
      </div>
    </div>
  );
}
