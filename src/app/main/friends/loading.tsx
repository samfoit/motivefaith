"use client";

import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

/**
 * Route-level loading geometry for `/main/friends`.
 *
 * The boxes mirror what `FriendsClient` actually renders — title, search
 * field, tab pill, then friend rows at the card's real size (32px avatar in
 * a `p-3` row, not a 48px one in `px-4 py-3`). The old copy was taller than
 * the screen it stood in for, so the content visibly jumped up when it
 * arrived.
 */
export default function FriendsLoading() {
  return (
    <SkeletonScreen
      label="Loading friends"
      className="max-w-2xl mx-auto px-4 pt-4 space-y-4 sm:pt-6 sm:space-y-6"
    >
      <Skeleton variant="text" width="30%" height={32} />
      <Skeleton variant="rect" width="100%" height={44} className="rounded-lg" />
      <div>
        <Skeleton variant="rect" width="100%" height={48} className="rounded-lg mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
            >
              <Skeleton variant="circle" width={32} height={32} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton variant="text" width="40%" height={14} />
                <Skeleton variant="text" width="25%" height={12} />
              </div>
              <Skeleton variant="rect" width={32} height={32} className="rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
