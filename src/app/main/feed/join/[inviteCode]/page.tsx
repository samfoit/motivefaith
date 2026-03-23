import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { JoinClient } from "./join-client";

interface Props {
  params: Promise<{ inviteCode: string }>;
}

export default async function JoinGroupPage({ params }: Props) {
  const { inviteCode } = await params;
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const { data: groupRows } = await supabase.rpc(
    "get_group_by_invite_code",
    { p_code: inviteCode },
  );
  const groupData = groupRows?.[0] ?? null;

  if (!groupData) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-bg-secondary flex items-center justify-center mx-auto mb-4">
            <Users className="w-6 h-6 text-text-tertiary" />
          </div>
          <h1
            className="font-display font-bold text-text-primary mb-2"
            style={{ fontSize: "var(--text-xl)" }}
          >
            Invite not found
          </h1>
          <p className="text-sm text-text-secondary mb-4">
            Invalid or expired invite link
          </p>
        </div>
      </div>
    );
  }

  // Check membership and get member count in parallel
  const [{ data: existing }, { count }] = await Promise.all([
    supabase
      .from("group_members")
      .select("id")
      .eq("group_id", groupData.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("group_members")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupData.id),
  ]);

  // Already a member — redirect to group page
  if (existing) {
    redirect(`/main/feed/group/${groupData.id}`);
  }

  return (
    <JoinClient
      group={{
        ...groupData,
        memberCount: count ?? 0,
      }}
      inviteCode={inviteCode}
    />
  );
}
