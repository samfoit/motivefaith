import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { QuickCaptureFlow } from "@/components/habits/QuickCaptureFlow";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { Skeleton } from "@/components/ui/Skeleton";

/** Skeleton shown inside the content area while AuthGate resolves. */
function MainContentSkeleton() {
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

/**
 * Async server component that validates auth and profile completeness.
 * Runs inside a Suspense boundary so the app shell (TopBar, BottomNav)
 * streams immediately without waiting for these checks.
 *
 * The middleware (proxy.ts) already redirects unauthenticated users,
 * so this is defense-in-depth that rarely fires.
 */
async function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getProfile(user.id);

  if (!profile?.date_of_birth) {
    redirect("/auth/complete-profile");
  }

  return <>{children}</>;
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[var(--color-bg-primary)]">
      <NavigationProgress />
      <OfflineIndicator />
      <TopBar />
      <main className="pb-24">
        <Suspense fallback={<MainContentSkeleton />}>
          <AuthGate>{children}</AuthGate>
        </Suspense>
      </main>
      <BottomNav />
      <QuickCaptureFlow />
      <InstallPrompt />
    </div>
  );
}
