"use client";

import { Skeleton } from "@/components/ui/Skeleton";

function FriendRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-elevated px-4 py-3 shadow-sm">
      <Skeleton variant="circle" width={48} height={48} />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton variant="text" width="45%" height={16} />
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="circle" width={16} height={16} />
          ))}
        </div>
        <Skeleton variant="text" width="65%" height={12} />
      </div>
      <Skeleton variant="circle" width={10} height={10} />
    </div>
  );
}

export default function FeedLoading() {
  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        <Skeleton variant="text" width={80} height={32} />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <FriendRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
