"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Check, Clock, UserX, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  clearPendingInvite,
  persistPendingInvite,
  readPendingInvite,
} from "@/lib/constants/pending-invite";
import {
  useSendFriendRequest,
  useAcceptFriendRequest,
  type FriendProfile,
} from "@/lib/hooks/useFriends";
import { createClient } from "@/lib/supabase/client";

export type InviteState =
  | { kind: "anonymous" }
  | { kind: "not_found" }
  | { kind: "incomplete_profile" }
  | { kind: "self" }
  | { kind: "ready"; inviter: FriendProfile }
  | { kind: "friends"; inviter: FriendProfile }
  | { kind: "outgoing"; inviter: FriendProfile }
  | { kind: "incoming"; inviter: FriendProfile; friendshipId: string };

interface InviteClientProps {
  state: InviteState;
  username: string | null;
}

export function InviteClient({ state, username }: InviteClientProps) {
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();

  const sendRequest = useSendFriendRequest();
  const acceptRequest = useAcceptFriendRequest();

  // Which of the two terminal states the page has reached by its own doing,
  // as opposed to the one the server handed it.
  const [done, setDone] = useState<"sent" | "accepted" | null>(null);

  // The invite is spent the moment a signed-in viewer sees this page: whatever
  // happens next, it should not fire again on their next login.
  const arrivedFromSignup = useRef(false);
  useEffect(() => {
    if (state.kind === "anonymous" || state.kind === "incomplete_profile") return;
    arrivedFromSignup.current = readPendingInvite() !== null;
    clearPendingInvite();
  }, [state.kind]);

  // The viewer has a session but an unfinished profile. Park the invite and
  // send them to the form the rest of the app would have sent them to; it
  // ends with `destinationAfterAuth()`, which brings them straight back.
  useEffect(() => {
    if (state.kind !== "incomplete_profile") return;
    if (username) persistPendingInvite(username);
    router.replace("/auth/complete-profile");
  }, [state.kind, username, router]);

  // Someone who just made an account to answer this invite has already said
  // what they want. Making them tap "Add friend" on the far side of signup is
  // asking the same question twice, so that path sends the request itself.
  // A viewer who was already signed in gets the button — they may well have
  // opened the link out of curiosity.
  const autoSent = useRef(false);
  useEffect(() => {
    if (state.kind !== "ready" || autoSent.current) return;
    if (!arrivedFromSignup.current) return;
    autoSent.current = true;
    void handleSend();
    // handleSend is stable for the life of this state; re-running on identity
    // changes would double-send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  async function handleSend() {
    if (state.kind !== "ready") return;
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (!user) return;

    try {
      await sendRequest.mutateAsync({
        requesterId: user.id,
        addresseeId: state.inviter.id,
      });
      setDone("sent");
    } catch {
      showToast({ variant: "error", title: "Could not send the request" });
    }
  }

  async function handleAccept() {
    if (state.kind !== "incoming") return;
    try {
      await acceptRequest.mutateAsync(state.friendshipId);
      setDone("accepted");
    } catch {
      showToast({ variant: "error", title: "Could not accept the request" });
    }
  }

  function goToSignup(path: string) {
    if (username) persistPendingInvite(username);
    router.push(path);
  }

  return (
    <div className="min-h-dvh bg-bg-primary flex items-center justify-center p-4">
      {ToastElements}
      <div className="w-full max-w-sm text-center">
        {renderBody()}
      </div>
    </div>
  );

  function renderBody() {
    if (done === "sent" && state.kind === "ready") {
      return (
        <Card
          inviter={state.inviter}
          title="Request sent"
          body={`${state.inviter.display_name} will see it in their Requests tab. You can start setting up habits in the meantime.`}
        >
          <Button className="w-full" size="lg" onClick={() => router.push("/main/dashboard")}>
            Get started
          </Button>
        </Card>
      );
    }

    if (done === "accepted" && state.kind === "incoming") {
      return (
        <Card
          inviter={state.inviter}
          title={`You and ${state.inviter.display_name} are friends`}
          body="You can see each other's shared habits and cheer each other on."
        >
          <Button className="w-full" size="lg" onClick={() => router.push("/main/friends")}>
            See your friends
          </Button>
        </Card>
      );
    }

    switch (state.kind) {
      case "incomplete_profile":
        return (
          <p className="text-sm text-text-secondary">
            Finishing setting up your account…
          </p>
        );

      case "anonymous":
        return (
          <Card
            icon={<Sparkles className="w-8 h-8 text-brand" />}
            title={`@${username} invited you to Motive`}
            body="Track the habits that matter, with people who keep you honest. Make an account and we'll send them a friend request."
          >
            <Button className="w-full" size="lg" onClick={() => goToSignup("/auth/signup")}>
              Create your account
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => goToSignup("/auth/login")}
            >
              I already have one
            </Button>
          </Card>
        );

      case "not_found":
        return (
          <Card
            icon={<UserX className="w-8 h-8 text-text-tertiary" />}
            iconMuted
            title="Invite not found"
            body={
              username
                ? `We couldn't find anyone with the username @${username}. The link may have a typo, or they may have changed their username.`
                : "That link doesn't look like an invite."
            }
          >
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => router.push("/main/friends")}
            >
              Find friends
            </Button>
          </Card>
        );

      case "self":
        return (
          <Card
            icon={<Sparkles className="w-8 h-8 text-brand" />}
            title="This is your own invite link"
            body="Send it to someone else and they'll land here with your name on it."
          >
            <Button className="w-full" size="lg" onClick={() => router.push("/main/friends")}>
              Back to Friends
            </Button>
          </Card>
        );

      case "ready":
        return (
          <Card
            inviter={state.inviter}
            title={`${state.inviter.display_name} invited you`}
            body={`@${state.inviter.username} shared their invite link with you. Send them a friend request to get started.`}
          >
            <Button
              className="w-full"
              size="lg"
              onClick={handleSend}
              loading={sendRequest.isPending}
            >
              <UserPlus className="w-4 h-4" />
              <span>Add {state.inviter.display_name}</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => router.push("/main/dashboard")}
            >
              Not now
            </Button>
          </Card>
        );

      case "incoming":
        return (
          <Card
            inviter={state.inviter}
            title={`${state.inviter.display_name} already sent you a request`}
            body="Accept it and you'll be friends."
          >
            <Button
              className="w-full"
              size="lg"
              onClick={handleAccept}
              loading={acceptRequest.isPending}
            >
              <Check className="w-4 h-4" />
              <span>Accept</span>
            </Button>
          </Card>
        );

      case "outgoing":
        return (
          <Card
            inviter={state.inviter}
            icon={<Clock className="w-8 h-8 text-text-tertiary" />}
            iconMuted
            title="Request pending"
            body={`You've already asked to be friends with ${state.inviter.display_name}. They just need to accept it.`}
          >
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => router.push("/main/dashboard")}
            >
              Continue
            </Button>
          </Card>
        );

      case "friends":
        return (
          <Card
            inviter={state.inviter}
            title={`You and ${state.inviter.display_name} are already friends`}
            body="Nothing to do here."
          >
            <Button
              className="w-full"
              size="lg"
              onClick={() => router.push("/main/friends")}
            >
              See your friends
            </Button>
          </Card>
        );
    }
  }
}

// ---------------------------------------------------------------------------

function Card({
  inviter,
  icon,
  iconMuted,
  title,
  body,
  children,
}: {
  inviter?: FriendProfile;
  icon?: React.ReactNode;
  iconMuted?: boolean;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {inviter && !icon ? (
        <Avatar
          src={inviter.avatar_url}
          name={inviter.display_name}
          size="lg"
          className="mx-auto mb-4"
        />
      ) : (
        <div
          className={
            "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 " +
            (iconMuted ? "bg-bg-secondary" : "bg-brand-light")
          }
        >
          {icon}
        </div>
      )}

      <h1
        className="font-display font-bold text-text-primary mb-2 text-balance"
        style={{ fontSize: "var(--text-xl)" }}
      >
        {title}
      </h1>

      <p className="text-sm text-text-secondary mb-6">{body}</p>

      <div className="space-y-2">{children}</div>
    </>
  );
}
