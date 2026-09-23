import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { parseInviteUsername } from "@/lib/constants/pending-invite";
import { InviteClient, type InviteState } from "./invite-client";
import type { FriendProfile } from "@/lib/hooks/useFriends";

interface Props {
  params: Promise<{ username: string }>;
}

/**
 * The invited person's landing page.
 *
 * Public on purpose: this is the one screen someone sees before they have an
 * account, and bouncing them to a bare login form is how the invite gets lost.
 * What it can say to a logged-out visitor is limited by RLS — `anon` cannot
 * read profiles at all — so it shows the username from the URL and nothing
 * more. Once they are signed in, `search_profiles` fills in the real name and
 * avatar.
 */
export default async function InvitePage({ params }: Props) {
  const { username: raw } = await params;
  const username = parseInviteUsername(raw);

  const {
    data: { user },
  } = await getAuthUser();

  if (!username) {
    return <InviteClient state={{ kind: "not_found" }} username={null} />;
  }

  if (!user) {
    return <InviteClient state={{ kind: "anonymous" }} username={username} />;
  }

  return <InviteClient state={await resolve(user.id, username)} username={username} />;
}

/** Work out what this invite means for the signed-in viewer. */
async function resolve(userId: string, username: string): Promise<InviteState> {
  const supabase = await createServerSupabase();

  const { data: me } = await supabase
    .from("profiles")
    .select("username, date_of_birth")
    .eq("id", userId)
    .single();

  // This route sits outside `/main`, so the AuthGate that turns an incomplete
  // profile back to `/auth/complete-profile` never runs for it. An OAuth user
  // who abandoned that form and opened an invite link would otherwise send a
  // friend request under a placeholder `user_xxxxxxxx` username. The invite is
  // held rather than dropped: the client stores it and comes back here.
  if (!me?.date_of_birth) return { kind: "incomplete_profile" };

  // Checked before the lookup, because `search_profiles` excludes the caller
  // and would otherwise report the viewer's own link as a dead one.
  if (me?.username?.toLowerCase() === username) return { kind: "self" };

  // A prefix search, rate-limited, that reaches profiles the viewer has no
  // relationship with — which a plain select on `profiles` cannot do.
  const { data: matches } = await untypedRpc<FriendProfile[]>(
    supabase,
    "search_profiles",
    { p_query: username },
  );

  const inviter = (matches ?? []).find(
    (p) => p.username.toLowerCase() === username,
  );

  if (!inviter) return { kind: "not_found" };

  const { data: friendship } = await supabase
    .from("friendships")
    .select("id, register_id, addressee_id, status")
    .or(
      `and(register_id.eq.${userId},addressee_id.eq.${inviter.id}),` +
        `and(register_id.eq.${inviter.id},addressee_id.eq.${userId})`,
    )
    .maybeSingle();

  if (!friendship) return { kind: "ready", inviter };

  if (friendship.status === "accepted") return { kind: "friends", inviter };

  // Someone on one end blocked the other. Saying so would tell the blocked
  // party they were blocked, so this reads as a link that does not resolve.
  if (friendship.status === "blocked") return { kind: "not_found" };

  return friendship.addressee_id === userId
    ? { kind: "incoming", inviter, friendshipId: friendship.id }
    : { kind: "outgoing", inviter };
}
