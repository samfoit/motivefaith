"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function NewGroupLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        <Skeleton variant="text" width="40%" height={32} />
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton variant="text" width={100} height={14} />
            <Skeleton variant="rect" width="100%" height={44} className="rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton variant="text" width={100} height={14} />
            <Skeleton variant="rect" width="100%" height={80} className="rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton variant="text" width={120} height={14} />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-elevated px-4 py-3">
                <Skeleton variant="circle" width={40} height={40} />
                <Skeleton variant="text" width="40%" height={16} />
              </div>
            ))}
          </div>
          <Skeleton variant="rect" width="100%" height={48} className="rounded-lg" />
        </div>
      </div>
    </div>
  );
}
