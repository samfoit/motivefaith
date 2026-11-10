import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { fetchLateHabits } from "@/lib/data/late-habits";
import { InboxClient } from "./inbox-client";
import InboxLoading from "./loading";
import {
  toPartnerInboxItem,
  type PartnerInboxItem,
  type PartnerInboxRpcRow,
} from "@/lib/types/partners";

export const revalidate = 120;

export default async function InboxPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  return (
    <Suspense fallback={<InboxLoading />}>
      <InboxData userId={user.id} />
    </Suspense>
  );
}

async function InboxData({ userId }: { userId: string }) {
  const supabase = await createServerSupabase();

  // Friends' habits waiting on a word from you: the same rows each friend's
  // chat shows on its card, so every one here has its card where it leads.
  // A failure there lists none rather than taking the partnership section
  // down with it — they are independent, and an unanswered invitation is the
  // more actionable of the two.
  const [lateHabits, { data: partnerRows, error: partnerError }] =
    await Promise.all([
      fetchLateHabits(supabase),
      untypedRpc<PartnerInboxRpcRow[]>(supabase, "get_partner_inbox"),
    ]);

  if (partnerError) {
    console.error("get_partner_inbox RPC failed:", partnerError.message);
  }

  const partnerItems: PartnerInboxItem[] = (partnerRows ?? []).map(
    toPartnerInboxItem,
  );

  return (
    <InboxClient
      lateHabits={lateHabits}
      partnerItems={partnerItems}
      userId={userId}
    />
  );
}
