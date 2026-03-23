import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { WeeklySummaryClient } from "./weekly-client";

export default async function WeeklySummaryPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  return <WeeklySummaryClient userId={user.id} />;
}
