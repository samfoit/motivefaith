import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";
import { QuickCaptureFlow } from "@/components/habits/QuickCaptureFlow";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Block access if profile is incomplete (e.g. OAuth user skipped /auth/complete-profile)
  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("id", user.id)
    .single();

  if (!profile?.date_of_birth) {
    redirect("/auth/complete-profile");
  }

  return (
    <div className="min-h-dvh bg-[var(--color-bg-primary)]">
      <TopBar userId={user.id} />
      <main className="pb-24">{children}</main>
      <BottomNav />
      <QuickCaptureFlow />
      <InstallPrompt />
    </div>
  );
}
