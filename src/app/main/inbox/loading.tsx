"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function InboxLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        <Skeleton variant="text" width={80} height={32} />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-4 rounded-lg bg-elevated shadow-sm"
            >
              <Skeleton variant="circle" width={32} height={32} />
              <div className="flex-1 space-y-1">
                <Skeleton variant="text" width="40%" height={16} />
                <Skeleton variant="text" width="60%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
