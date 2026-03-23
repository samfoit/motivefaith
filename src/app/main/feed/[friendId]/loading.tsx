"use client";

import { Skeleton } from "@/components/ui/Skeleton";

export default function JourneyLoading() {
  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header: back + avatar + name */}
        <div className="flex items-center gap-3">
          <Skeleton variant="circle" width={32} height={32} />
          <Skeleton variant="circle" width={36} height={36} />
          <div className="space-y-1.5">
            <Skeleton variant="text" width={120} height={18} />
            <Skeleton variant="text" width={80} height={14} />
          </div>
        </div>

        {/* Shared Habits section */}
        <div className="space-y-3">
          <Skeleton variant="text" width={120} height={16} />
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg bg-elevated p-4 shadow-sm border-l-[3px] border-gray-200 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Skeleton variant="circle" width={24} height={24} />
                <Skeleton variant="text" width="50%" height={18} />
              </div>
              <Skeleton variant="text" width="30%" height={14} />
            </div>
          ))}
        </div>

        {/* Timeline section */}
        <div className="space-y-3">
          <Skeleton variant="text" width={100} height={16} />
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
      </div>
    </div>
  );
}
