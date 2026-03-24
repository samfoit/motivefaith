import { Skeleton } from "@/components/ui/Skeleton";

export default function ProfileLoading() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Profile header */}
        <div className="flex items-center gap-4">
          <Skeleton variant="circle" width={64} height={64} decorative />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton variant="text" width="45%" height={20} decorative />
            <Skeleton variant="text" width="30%" height={14} decorative />
          </div>
        </div>

        {/* Settings sections */}
        <div className="space-y-5">
          {/* Appearance section */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Skeleton variant="rect" width={16} height={16} className="rounded" decorative />
              <Skeleton variant="text" width={100} height={12} decorative />
            </div>
            <div className="rounded-lg bg-elevated p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <Skeleton variant="text" width={60} height={14} decorative />
                <Skeleton variant="rect" width={44} height={24} className="rounded-full" decorative />
              </div>
            </div>
          </section>

          {/* Notifications section */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Skeleton variant="rect" width={16} height={16} className="rounded" decorative />
              <Skeleton variant="text" width={120} height={12} decorative />
            </div>
            <div className="rounded-lg bg-elevated p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <Skeleton variant="text" width={140} height={14} decorative />
                <Skeleton variant="rect" width={44} height={24} className="rounded-full" decorative />
              </div>
            </div>
          </section>

          {/* Support section */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Skeleton variant="rect" width={16} height={16} className="rounded" decorative />
              <Skeleton variant="text" width={80} height={12} decorative />
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-elevated p-4 shadow-sm">
              <Skeleton variant="rect" width={28} height={28} className="rounded" decorative />
              <div className="space-y-1.5">
                <Skeleton variant="text" width={130} height={14} decorative />
                <Skeleton variant="text" width={180} height={12} decorative />
              </div>
            </div>
          </section>

          {/* Sign out button */}
          <Skeleton variant="rect" width="100%" height={40} className="rounded-lg" decorative />
        </div>
      </div>
    </div>
  );
}
