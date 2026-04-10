"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { untypedRpc } from "@/lib/supabase/rpc";

interface JoinClientProps {
  group: {
    id: string;
    name: string;
    description: string | null;
    avatar_url: string | null;
    memberCount: number;
  };
  inviteCode: string;
}

export function JoinClient({ group, inviteCode }: JoinClientProps) {
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();
  const [joining, setJoining] = useState(false);

  const handleJoin = useCallback(async () => {
    setJoining(true);
    const supabase = createClient();

    const { error: joinErr } = await untypedRpc(
      supabase,
      "join_group_by_invite_code",
      { p_code: inviteCode },
    );

    if (joinErr) {
      showToast({ variant: "error", title: "Failed to join group" });
      setJoining(false);
      return;
    }

    showToast({ variant: "success", title: `Joined ${group.name}!` });
    router.push(`/main/feed/group/${group.id}`);
    router.refresh();
  }, [group, inviteCode, showToast, router]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        {group.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={group.avatar_url}
            alt={group.name}
            className="w-20 h-20 rounded-full object-cover mx-auto mb-4"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-brand" />
          </div>
        )}

        <h1
          className="font-display font-bold text-text-primary mb-1"
          style={{ fontSize: "var(--text-xl)" }}
        >
          {group.name}
        </h1>

        {group.description && (
          <p className="text-sm text-text-secondary mb-2">
            {group.description}
          </p>
        )}

        <p className="text-xs text-text-tertiary mb-6">
          {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
        </p>

        <Button
          className="w-full"
          size="lg"
          onClick={handleJoin}
          loading={joining}
        >
          Join Group
        </Button>
      </div>
      {ToastElements}
    </div>
  );
}
