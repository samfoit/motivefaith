"use client";

import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

// The wizard's first step, block for block: the steps, the card, the icon
// and color rows, the group of settings, and the button.
export default function NewHabitLoading() {
  return (
    <div className="min-h-screen">
      <SkeletonScreen label="Loading" className="max-w-lg mx-auto px-4 pt-4">
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton variant="rect" width="100%" height={4} className="rounded-full" />
              <Skeleton variant="text" width={56} height={12} />
            </div>
          ))}
        </div>
        <Skeleton variant="rect" width="100%" height={64} className="rounded-lg" />
        <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <Skeleton variant="text" width={32} height={12} />
            <div className="flex gap-2 py-1">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} variant="rect" width={44} height={44} className="rounded-lg shrink-0" />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton variant="text" width={40} height={12} />
            <div className="flex gap-2 py-1">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} variant="circle" width={44} height={44} className="shrink-0" />
              ))}
            </div>
          </div>
          <Skeleton variant="rect" width="100%" height={146} className="rounded-lg" />
        </div>
        <Skeleton variant="rect" width="100%" height={48} className="rounded-lg mt-9" />
      </SkeletonScreen>
    </div>
  );
}
