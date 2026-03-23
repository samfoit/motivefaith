import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { WizardClient } from "./wizard-client";

export default async function NewHabitPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) {
    redirect("/auth/login");
  }

  return <WizardClient userId={user.id} />;
}
