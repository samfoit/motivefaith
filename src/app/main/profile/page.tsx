import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { ProfileClient } from "./profile-client";
import ProfileLoading from "./loading";
import type { Tables, Json } from "@/lib/supabase/types";

export const revalidate = 120;

export default async function ProfilePage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfileData userId={user.id} />
    </Suspense>
  );
}

async function ProfileData({ userId }: { userId: string }) {
  const supabase = await createServerSupabase();

  type NotificationSettings = { push_subscription: Json | null; notification_prefs: Json | null };

  const [{ data: profile }, settingsResult, { data: isAdmin }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url, timezone, date_of_birth, created_at")
      .eq("id", userId)
      .single(),
    untypedRpc<NotificationSettings[]>(supabase, "get_own_notification_settings"),
    untypedRpc<boolean>(supabase, "is_app_admin"),
  ]);

  const settings = settingsResult.data?.[0] ?? null;

  const fullProfile: Tables<"profiles"> | null = profile
    ? { ...profile, push_subscription: settings?.push_subscription ?? null, notification_prefs: settings?.notification_prefs ?? null }
    : null;

  return <ProfileClient userId={userId} profile={fullProfile} isAdmin={!!isAdmin} />;
}
