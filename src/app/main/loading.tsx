import { Skeleton } from "@/components/ui/Skeleton";

/** Generic content skeleton shown during client-side page transitions. */
export default function MainLoading() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
      <div className="space-y-2">
        <Skeleton variant="text" width="55%" height={32} />
        <Skeleton variant="text" width="35%" height={16} />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <Skeleton variant="text" width={120} height={16} />
          <Skeleton variant="text" width={32} height={16} />
        </div>
        <Skeleton variant="rect" width="100%" height={8} className="rounded-full" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm border-l-[3px] border-gray-200">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton variant="circle" width={28} height={28} />
                <Skeleton variant="text" width="60%" height={20} />
              </div>
              <Skeleton variant="text" width="40%" height={14} />
            </div>
            <Skeleton variant="circle" width={40} height={40} />
          </div>
        ))}
      </div>
    </div>
  );
}
