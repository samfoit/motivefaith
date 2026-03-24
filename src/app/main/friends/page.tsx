import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { FriendsClient } from "./friends-client";
import { Skeleton } from "@/components/ui/Skeleton";
import type { FriendWithProfile } from "@/lib/hooks/useFriends";

export default async function FriendsPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  return (
    <Suspense fallback={<FriendsSkeleton />}>
      <FriendsData userId={user.id} />
    </Suspense>
  );
}

/** Shape returned by FK-joined friendship query (server-side mirror of hook). */
type FriendshipRow = {
  id: string;
  register_id: string;
  addressee_id: string;
  status: string;
  created_at: string;
  register: { id: string; display_name: string; username: string; avatar_url: string | null } | null;
  addressee: { id: string; display_name: string; username: string; avatar_url: string | null } | null;
};

function transformFriendships(
  data: unknown[] | null,
  userId: string,
): FriendWithProfile[] {
  const rows = (data ?? []) as FriendshipRow[];
  return rows
    .map((f) => {
      const profile =
        f.register_id === userId ? f.addressee : f.register;
      if (!profile) return null;
      return {
        id: f.id,
        register_id: f.register_id,
        addressee_id: f.addressee_id,
        status: f.status as "pending" | "accepted" | "blocked",
        created_at: f.created_at,
        profile,
      };
    })
    .filter(Boolean) as FriendWithProfile[];
}

const FRIENDSHIP_SELECT =
  "id, register_id, addressee_id, status, created_at, " +
  "register:profiles!register_id(id, display_name, username, avatar_url), " +
  "addressee:profiles!addressee_id(id, display_name, username, avatar_url)";

/** Async server component — fetches inside Suspense boundary. */
async function FriendsData({ userId }: { userId: string }) {
  const supabase = await createServerSupabase();

  // Parallel fetch: friends list + pending requests (mirrors client-side hooks)
  const [friendsResult, requestsResult] = await Promise.all([
    supabase
      .from("friendships")
      .select(FRIENDSHIP_SELECT)
      .eq("status", "accepted")
      .or(`register_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase
      .from("friendships")
      .select(FRIENDSHIP_SELECT)
      .eq("status", "pending")
      .or(`register_id.eq.${userId},addressee_id.eq.${userId}`),
  ]);

  const friends = transformFriendships(friendsResult.data, userId);
  const allRequests = transformFriendships(requestsResult.data, userId);
  const requests = {
    incoming: allRequests.filter((f) => f.addressee_id === userId),
    outgoing: allRequests.filter((f) => f.register_id === userId),
  };

  return (
    <FriendsClient
      userId={userId}
      initialFriends={friends}
      initialRequests={requests}
    />
  );
}

function FriendsSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        <Skeleton variant="text" width={120} height={32} />
        <Skeleton variant="rect" width="100%" height={44} className="rounded-lg" />
        <Skeleton variant="rect" width="100%" height={40} className="rounded-lg" />
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
            >
              <Skeleton variant="circle" width={32} height={32} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton variant="text" width="40%" height={14} />
                <Skeleton variant="text" width="25%" height={12} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
