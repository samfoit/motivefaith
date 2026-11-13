import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { JoinClient } from "./join-client";

interface Props {
  params: Promise<{ inviteCode: string }>;
}

/** A dead end with nothing to join: the link is no good, or was tried too often. */
function InviteMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-full bg-elevated shadow-sm flex items-center justify-center mx-auto mb-4">
          <Users className="w-6 h-6 text-text-tertiary" />
        </div>
        <h2
          className="font-display font-medium text-text-primary mb-2"
          style={{ fontSize: "var(--text-xl)" }}
        >
          {title}
        </h2>
        <p className="text-sm text-text-secondary mb-4">{children}</p>
      </div>
    </div>
  );
}

export default async function JoinGroupPage({ params }: Props) {
  const { inviteCode } = await params;
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  const { data: groupRows, error: lookupError } = await supabase.rpc(
    "get_group_by_invite_code",
    { p_code: inviteCode },
  );

  if (lookupError) {
    // The lookup's own limit (054): twenty codes a minute.
    if (lookupError.message.startsWith("Rate limit exceeded")) {
      return (
        <InviteMessage title="Too many tries">
          Wait a minute, then open the invite link again.
        </InviteMessage>
      );
    }
    // A lookup that failed is not a link that is wrong. Reading the two as
    // one is how every invite came to say "Invite not found" while the
    // lookup itself was failing each time; this goes to the error screen,
    // which says something went wrong and offers to try again.
    console.error("Group invite lookup failed:", lookupError.message);
    throw new Error("Couldn't load this invite");
  }

  const groupData = groupRows?.[0] ?? null;

  if (!groupData) {
    return (
      <InviteMessage title="Invite not found">
        Invalid or expired invite link
      </InviteMessage>
    );
  }

  // Only a member can read the member list, so this finds a row exactly when
  // the viewer is already in the group. The count comes with the lookup for
  // the same reason: someone who has not joined would count nobody.
  const { data: existing } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupData.id)
    .eq("user_id", user.id)
    .maybeSingle();

  // Already a member — redirect to group page
  if (existing) {
    redirect(`/main/feed/group/${groupData.id}`);
  }

  return (
    <JoinClient
      group={{
        id: groupData.id,
        name: groupData.name,
        description: groupData.description,
        avatar_url: groupData.avatar_url,
        memberCount: groupData.member_count,
      }}
      inviteCode={inviteCode}
    />
  );
}
