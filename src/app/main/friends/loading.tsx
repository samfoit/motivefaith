"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function FriendsLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton variant="text" width="30%" height={32} />
          <Skeleton variant="rect" width={100} height={36} className="rounded-lg" />
        </div>
        <Skeleton variant="rect" width="100%" height={44} className="rounded-lg" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 shadow-sm">
              <Skeleton variant="circle" width={48} height={48} />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton variant="text" width="50%" height={16} />
                <Skeleton variant="text" width="30%" height={12} />
              </div>
              <Skeleton variant="rect" width={80} height={32} className="rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
