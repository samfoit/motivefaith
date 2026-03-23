import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { ModerationClient } from "./moderation-client";
import type { Tables } from "@/lib/supabase/types";

export const revalidate = 0; // Always fresh for admin dashboard

export default async function ModerationPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const { data: isAdmin } = await untypedRpc<boolean>(supabase, "is_app_admin");

  if (!isAdmin) redirect("/main/dashboard");

  type ContentReportRow = Tables<"content_reports"> & { reviewed_by: string | null };

  const { data: rawReports, count } = await supabase
    .from("content_reports")
    .select("*", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .range(0, 19);

  // Cast to include reviewed_by (migration 026, not in generated types)
  const reports = rawReports as ContentReportRow[] | null;

  // Fetch reporter profiles
  const reporterIds = [...new Set((reports ?? []).map((r) => r.reporter_id))];
  const { data: reporters } = reporterIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", reporterIds)
    : { data: [] };

  const reporterMap = new Map(
    (reporters ?? []).map((p) => [p.id, p]),
  );

  const enriched = (reports ?? []).map((r) => ({
    ...r,
    status: r.status ?? "pending",
    created_at: r.created_at ?? new Date().toISOString(),
    reporter: reporterMap.get(r.reporter_id) ?? null,
    content: null,
  }));

  return (
    <ModerationClient
      initialReports={enriched}
      initialTotal={count ?? 0}
    />
  );
}
