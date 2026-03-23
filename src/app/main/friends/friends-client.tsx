"use client";

import { useState, useDeferredValue, useEffect, useMemo } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  UserPlus,
  UserMinus,
  Check,
  X,
  Loader2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { FRIEND_POLL_MIN_MS, FRIEND_POLL_JITTER_MS } from "@/lib/constants/limits";
import {
  useFriendsList,
  useFriendRequests,
  useSearchUsers,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useRemoveFriend,
  type FriendProfile,
  type FriendWithProfile,
} from "@/lib/hooks/useFriends";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAB_TRIGGER_CLASS = cn(
  "flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors text-center",
  "text-[var(--color-text-secondary)]",
  "data-[state=active]:bg-brand data-[state=active]:text-white",
  "hover:text-[var(--color-text-primary)]",
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FriendsClient({
  userId,
  initialFriends,
  initialRequests,
}: {
  userId: string;
  initialFriends?: FriendWithProfile[];
  initialRequests?: { incoming: FriendWithProfile[]; outgoing: FriendWithProfile[] };
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const { show: showToast, ToastElements } = useToast();
  const queryClient = useQueryClient();

  // Realtime: live-update friend requests & list.
  // Only subscribes to INSERT (new requests for me) and UPDATE (acceptance
  // of my requests). DELETE events cannot be filtered by Supabase Realtime
  // (would receive all deletes system-wide), so we use a 60s poll instead.
  useEffect(() => {
    const supabase = createClient();
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ["friends"] });

    const channel = supabase
      .channel("friendships-realtime")
      // Someone sent me a friend request
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friendships",
          filter: `addressee_id=eq.${userId}`,
        },
        invalidate,
      )
      // Someone accepted my outgoing request
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "friendships",
          filter: `register_id=eq.${userId}`,
        },
        invalidate,
      )
      .subscribe();

    // Poll to catch deletions (friend removals) since Supabase Realtime can't
    // filter DELETE events — unfiltered DELETE would receive every friendship
    // deletion system-wide, wasting bandwidth at scale.
    // Jittered interval (45-75s) prevents thundering-herd when many clients
    // are open simultaneously.
    let pollTimer: ReturnType<typeof setTimeout>;
    const schedulePoll = () => {
      const jitter = FRIEND_POLL_MIN_MS + Math.random() * FRIEND_POLL_JITTER_MS;
      pollTimer = setTimeout(() => {
        invalidate();
        schedulePoll();
      }, jitter);
    };
    schedulePoll();

    return () => {
      supabase.removeChannel(channel);
      clearTimeout(pollTimer);
    };
  }, [queryClient, userId]);

  // Queries — pass server-fetched data as initialData to avoid loading flash
  const friends = useFriendsList(userId, initialFriends ? { initialData: initialFriends } : undefined);
  const requests = useFriendRequests(userId, initialRequests ? { initialData: initialRequests } : undefined);
  const search = useSearchUsers(deferredQuery, userId);

  // Mutations
  const sendRequest = useSendFriendRequest();
  const acceptRequest = useAcceptFriendRequest();
  const declineRequest = useDeclineFriendRequest();
  const removeFriend = useRemoveFriend();

  const isSearching = searchQuery.length >= 2;

  // Build a set of IDs we already have a relationship with
  const existingRelationIds = useMemo(() => {
    const ids = new Set<string>();
    friends.data?.forEach((f) => ids.add(f.profile.id));
    requests.data?.incoming.forEach((f) => ids.add(f.profile.id));
    requests.data?.outgoing.forEach((f) => ids.add(f.profile.id));
    return ids;
  }, [friends.data, requests.data]);

  // --- Handlers ---

  const handleSendRequest = async (addresseeId: string) => {
    try {
      await sendRequest.mutateAsync({
        requesterId: userId,
        addresseeId,
      });
      showToast({ variant: "success", title: "Friend request sent" });
    } catch {
      showToast({ variant: "error", title: "Failed to send request" });
    }
  };

  const handleAccept = async (friendshipId: string) => {
    try {
      await acceptRequest.mutateAsync(friendshipId);
      showToast({ variant: "success", title: "Friend request accepted" });
    } catch {
      showToast({ variant: "error", title: "Failed to accept request" });
    }
  };

  const handleDecline = async (friendshipId: string) => {
    try {
      await declineRequest.mutateAsync(friendshipId);
    } catch {
      showToast({ variant: "error", title: "Failed to decline request" });
    }
  };

  const handleRemove = async (friendshipId: string) => {
    try {
      await removeFriend.mutateAsync(friendshipId);
      showToast({ variant: "info", title: "Friend removed" });
    } catch {
      showToast({ variant: "error", title: "Failed to remove friend" });
    }
  };

  const incomingCount = requests.data?.incoming.length ?? 0;

  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <h1
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-2xl)" }}
        >
          Friends
        </h1>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search by username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full rounded-lg border bg-elevated pl-10 pr-4 py-2.5 text-base",
              "placeholder:text-[var(--color-text-tertiary)]",
              "border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand",
              "transition-colors",
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--color-surface-hover)]"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
            </button>
          )}
        </div>

        {/* Search results */}
        {isSearching && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">
              Search results
            </h2>
            {search.isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-tertiary)]" />
              </div>
            ) : search.data && search.data.length > 0 ? (
              <div className="space-y-2">
                {search.data.map((profile) => (
                  <SearchResultCard
                    key={profile.id}
                    profile={profile}
                    alreadyConnected={existingRelationIds.has(profile.id)}
                    onSendRequest={() => handleSendRequest(profile.id)}
                    isSending={sendRequest.isPending}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)] text-center py-6">
                No users found for &ldquo;{searchQuery}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Tabs: Friends / Requests */}
        {!isSearching && (
          <Tabs.Root defaultValue="friends">
            <Tabs.List
              className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary)] mb-4"
              aria-label="Friends sections"
            >
              <Tabs.Trigger value="friends" className={TAB_TRIGGER_CLASS}>
                Friends
                {friends.data && friends.data.length > 0 && (
                  <span className="ml-1.5 text-xs opacity-70">
                    {friends.data.length}
                  </span>
                )}
              </Tabs.Trigger>
              <Tabs.Trigger value="requests" className={TAB_TRIGGER_CLASS}>
                Requests
                {incomingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-miss text-white text-xs font-medium">
                    {incomingCount}
                  </span>
                )}
              </Tabs.Trigger>
            </Tabs.List>

            {/* --- Friends Tab --- */}
            <Tabs.Content value="friends">
              {friends.isLoading ? (
                <LoadingState />
              ) : friends.data && friends.data.length > 0 ? (
                <div className="fr-stagger-container space-y-2">
                  {friends.data.map((friend) => (
                    <div key={friend.id}>
                      <FriendCard
                        friend={friend}
                        onRemove={() => handleRemove(friend.id)}
                        isRemoving={removeFriend.isPending}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  emoji="👋"
                  title="No friends yet"
                  description="Search for friends by username to get started"
                />
              )}
            </Tabs.Content>

            {/* --- Requests Tab --- */}
            <Tabs.Content value="requests">
              {requests.isLoading ? (
                <LoadingState />
              ) : (
                <div className="space-y-6">
                  {/* Incoming */}
                  {requests.data && requests.data.incoming.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                        Incoming
                      </h3>
                      <div className="fr-stagger-container space-y-2">
                        {requests.data.incoming.map((req) => (
                          <div key={req.id}>
                            <IncomingRequestCard
                              request={req}
                              onAccept={() => handleAccept(req.id)}
                              onDecline={() => handleDecline(req.id)}
                              isAccepting={acceptRequest.isPending}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Outgoing */}
                  {requests.data && requests.data.outgoing.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-3">
                        Sent
                      </h3>
                      <div className="space-y-2">
                        {requests.data.outgoing.map((req) => (
                          <OutgoingRequestCard
                            key={req.id}
                            request={req}
                            onCancel={() => handleDecline(req.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty */}
                  {requests.data &&
                    requests.data.incoming.length === 0 &&
                    requests.data.outgoing.length === 0 && (
                      <EmptyState
                        emoji="📬"
                        title="No pending requests"
                        description="Friend requests you send or receive will show up here"
                      />
                    )}
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        )}
      </div>

      {ToastElements}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchResultCard({
  profile,
  alreadyConnected,
  onSendRequest,
  isSending,
}: {
  profile: FriendProfile;
  alreadyConnected: boolean;
  onSendRequest: () => void;
  isSending: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm">
      <Avatar src={profile.avatar_url} name={profile.display_name} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {profile.display_name}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          @{profile.username}
        </p>
      </div>
      {alreadyConnected ? (
        <span className="text-xs text-[var(--color-text-tertiary)] px-2">
          Connected
        </span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={onSendRequest}
          disabled={isSending}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Add</span>
        </Button>
      )}
    </div>
  );
}

function FriendCard({
  friend,
  onRemove,
  isRemoving,
}: {
  friend: FriendWithProfile;
  onRemove: () => void;
  isRemoving: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm">
      <Avatar
        src={friend.profile.avatar_url}
        name={friend.profile.display_name}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {friend.profile.display_name}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          @{friend.profile.username}
        </p>
      </div>
      {!confirmRemove ? (
        <button
          onClick={() => setConfirmRemove(true)}
          className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label={`Remove ${friend.profile.display_name}`}
        >
          <UserMinus className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        </button>
      ) : (
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRemove(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onRemove();
              setConfirmRemove(false);
            }}
            loading={isRemoving}
            className="bg-miss hover:bg-red-600 text-white"
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

function IncomingRequestCard({
  request,
  onAccept,
  onDecline,
  isAccepting,
}: {
  request: FriendWithProfile;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm border-l-[3px] border-brand">
      <Avatar
        src={request.profile.avatar_url}
        name={request.profile.display_name}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {request.profile.display_name}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          @{request.profile.username}
        </p>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={onDecline}
          className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
          aria-label="Decline request"
        >
          <X className="w-4 h-4 text-miss" />
        </button>
        <Button size="sm" onClick={onAccept} loading={isAccepting}>
          <Check className="w-3.5 h-3.5" />
          <span>Accept</span>
        </Button>
      </div>
    </div>
  );
}

function OutgoingRequestCard({
  request,
  onCancel,
}: {
  request: FriendWithProfile;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm">
      <Avatar
        src={request.profile.avatar_url}
        name={request.profile.display_name}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {request.profile.display_name}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Pending
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function EmptyState({
  emoji,
  title,
  description,
}: {
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-3">{emoji}</div>
      <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
        {title}
      </p>
      <p className="text-xs text-[var(--color-text-tertiary)]">
        {description}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2" role="status" aria-label="Loading friends">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
        >
          <Skeleton variant="circle" width={32} height={32} decorative />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton variant="text" width="40%" height={14} decorative />
            <Skeleton variant="text" width="25%" height={12} decorative />
          </div>
          <Skeleton variant="rect" width={32} height={32} className="rounded-lg" decorative />
        </div>
      ))}
    </div>
  );
}
