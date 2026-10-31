import { Skeleton, SkeletonScreen } from "@/components/ui/Skeleton";

export default function WeeklyReviewsLoading() {
  return (
    <SkeletonScreen label="Loading weekly reviews" className="max-w-2xl mx-auto px-4 pt-6 space-y-8">
      <section>
        <Skeleton variant="text" width={120} height={14} className="mb-2" decorative />
        <div className="rounded-lg bg-elevated p-4 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between">
            <Skeleton variant="text" width={72} height={28} decorative />
            <Skeleton variant="text" width={140} height={14} decorative />
          </div>
          <Skeleton variant="rect" width="100%" height={56} className="rounded-md" decorative />
        </div>
      </section>
      <section>
        <Skeleton variant="text" width={90} height={14} className="mb-2" decorative />
        <div className="rounded-lg bg-elevated shadow-sm divide-y divide-border">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton variant="text" width={112} height={14} decorative />
              <Skeleton variant="rect" width="100%" height={8} className="rounded-full flex-1" decorative />
            </div>
          ))}
        </div>
      </section>
    </SkeletonScreen>
  );
}
