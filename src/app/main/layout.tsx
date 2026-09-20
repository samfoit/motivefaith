import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { QuickCaptureFlow } from "@/components/habits/QuickCaptureFlow";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { NavigationProgress } from "@/components/layout/NavigationProgress";

/**
 * Validates auth and profile completeness before any of `/main/*` renders.
 *
 * It has to wrap `children`. As a sibling it resolved in *parallel* with the
 * page rather than in front of it, which meant a user with no
 * `date_of_birth` got the whole dashboard streamed, painted and interactive
 * before the redirect to `/auth/complete-profile` landed. The gate stopped
 * gating anything.
 *
 * What the sibling arrangement was avoiding is the double skeleton
 * (DIAGNOSIS.md R3): this boundary sits above the route's `loading.tsx`, so
 * its fallback used to play and then the route's fallback played after it
 * (~10ms and ~209ms). The fallback is `null` instead, which removes that
 * first layer without giving up the gate — the route's `loading.tsx` is
 * still the only skeleton the user sees. An empty content area for the
 * length of the auth round trips is what the 200ms delay-before-show would
 * have rendered for that window anyway.
 *
 * The cost is one `getProfile()` round trip ahead of the page's own queries.
 * Both calls here are `cache()`d and the page makes them too, so this is the
 * same work moved earlier, not extra work.
 */
async function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getProfile(user.id);

  // Orphaned auth user (profile row missing entirely) — usually the tail of a
  // failed account deletion where auth.admin.deleteUser() did not run to
  // completion. The sign-out has to happen in a Route Handler: cookie writes
  // from a Server Component are swallowed, so signing out here revoked the
  // refresh token but left the session cookie intact and looped the user
  // between proxy.ts and this gate. See src/app/auth/stale/route.ts.
  if (!profile) {
    redirect("/auth/stale");
  }

  if (!profile.date_of_birth) {
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
      {/* Persistent chrome: no data dependency, so it is always in the first
          flush of the response and paints with the document. */}
      <TopBar />
      <main className="pb-24">
        <Suspense fallback={null}>
          <AuthGate>{children}</AuthGate>
        </Suspense>
      </main>
      <BottomNav />
      <QuickCaptureFlow />
      <InstallPrompt />
    </div>
  );
}
