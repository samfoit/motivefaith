"use client";

import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

export default function JourneyLoading() {
  return (
    <div className="min-h-screen">
      <SkeletonScreen label="Loading journey" className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header: back + avatar + name */}
        <div className="flex items-center gap-3">
          <Skeleton variant="circle" width={32} height={32} />
          <Skeleton variant="circle" width={36} height={36} />
          <div className="space-y-1.5">
            <Skeleton variant="text" width={120} height={18} />
            <Skeleton variant="text" width={80} height={14} />
          </div>
        </div>

        {/* Shared habits: one line of chips */}
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

        {/* Timeline */}
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}
            >
              <Skeleton
                variant="rect"
                width="65%"
                height={56}
                className="rounded-lg"
              />
            </div>
          ))}
        </div>
      </SkeletonScreen>
    </div>
  );
}
