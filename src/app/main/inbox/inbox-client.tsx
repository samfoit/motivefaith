"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, X, HandHeart, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { todayDateKey, getBrowserTimezone } from "@/lib/utils/timezone";
import { usePartnerInbox } from "@/lib/hooks/usePartnerInbox";
import { useRespondToPartner } from "@/lib/hooks/usePartnerActions";
import type { PartnerInboxItem } from "@/lib/types/partners";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MissedHabitNotification = {
  habitId: string;
  title: string;
  emoji: string;
  color: string;
  friendId: string;
  friendName: string;
  friendAvatar: string | null;
  timeWindow: { start?: string; end?: string } | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxClient({
  missedHabits,
  partnerItems = [],
  userId = null,
}: {
  missedHabits: MissedHabitNotification[];
  partnerItems?: PartnerInboxItem[];
  userId?: string | null;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();
  const respond = useRespondToPartner();
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // Server data seeds the query so there is no loading flash, and answering
  // something invalidates it — which is also what keeps the TopBar badge in
  // step, since it reads the same query.
  const { data: partners = [] } = usePartnerInbox(userId, {
    initialData: partnerItems,
  });

  const invites = partners.filter((p) => p.direction === "invite");
  const requests = partners.filter((p) => p.direction === "request");

  const handleRespond = async (item: PartnerInboxItem, accept: boolean) => {
    setRespondingId(item.shareId);
    try {
      await respond.mutateAsync({ shareId: item.shareId, accept });
      showToast({
        variant: accept ? "success" : "info",
        title: accept
          ? item.direction === "invite"
            ? `Now watching ${item.habitTitle}`
            : "Partner added"
          : "Declined",
      });
      router.refresh();
    } catch (err) {
      showToast({
        variant: "error",
        title: err instanceof Error ? err.message : "Failed to answer",
      });
    }
    setRespondingId(null);
  };
  const storageKey = `dismissed-inbox-${todayDateKey(getBrowserTimezone())}`;

  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return new Set();
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    } catch {
      return new Set();
    }
  });

  const dismiss = useCallback((habitId: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(habitId);
      try { sessionStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
      return next;
    });
    // Force the TopBar badge to re-read sessionStorage and update immediately
    queryClient.refetchQueries({ queryKey: ["missed-habits-count"] });
  }, [storageKey, queryClient]);

  const visible = missedHabits.filter((n) => !dismissed.has(n.habitId));

  return (
    <div>
      <div className="max-w-2xl mx-auto px-3 pt-4 space-y-4">
        {/* Header */}
        <h1
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-2xl)" }}
        >
          Inbox
        </h1>

        {/* Partnership decisions come first — they are the only thing here
            that is waiting on the user, and they do not expire at midnight
            the way a missed-habit nudge does. */}
        {invites.length > 0 && (
          <PartnerSection
            title="Invitations"
            subtitle="Someone wants you watching their habit"
            icon={Mail}
            items={invites}
            respondingId={respondingId}
            onRespond={handleRespond}
            acceptLabel="Accept"
            describe={(item) => (
              <>
                wants you to watch{" "}
                <span className="font-medium">
                  {item.habitEmoji} {item.habitTitle}
                </span>
              </>
            )}
          />
        )}

        {requests.length > 0 && (
          <PartnerSection
            title="Requests to join"
            subtitle="Friends asking to watch your habits"
            icon={HandHeart}
            items={requests}
            respondingId={respondingId}
            onRespond={handleRespond}
            acceptLabel="Accept"
            describe={(item) => (
              <>
                asked to watch{" "}
                <span className="font-medium">
                  {item.habitEmoji} {item.habitTitle}
                </span>
              </>
            )}
          />
        )}

        {/* Missed habits list */}
        {visible.length > 0 && (
          <div className="space-y-3">
            {visible.map((item) => (
              <div
                key={item.habitId}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg shadow-sm",
                  "bg-elevated border-l-[3px] border-l-miss",
                )}
              >
                <Link
                  href={`/main/feed/${item.friendId}`}
                  className={cn(
                    "flex items-center gap-3 flex-1 min-w-0",
                    "hover:opacity-80 transition-opacity",
                  )}
                >
                  <Avatar
                    src={item.friendAvatar}
                    name={item.friendName}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                      {item.friendName}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)] truncate">
                      Hasn&apos;t completed{" "}
                      <span className="font-medium">
                        {item.emoji} {item.title}
                      </span>{" "}
                      today
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle
                      className="w-3.5 h-3.5 text-miss"
                    />
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => dismiss(item.habitId)}
                  className="p-1.5 -mr-1 rounded-md hover:bg-[var(--color-surface-hover)] transition-colors flex-shrink-0"
                  aria-label={`Dismiss notification for ${item.title}`}
                >
                  <X className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {visible.length === 0 && partners.length === 0 && (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center mx-auto mb-4">
              <Bell className="w-6 h-6 text-[var(--color-text-tertiary)]" />
            </div>
            <h2
              className="font-display font-semibold text-[var(--color-text-primary)] mb-2"
              style={{ fontSize: "var(--text-xl)" }}
            >
              All caught up
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-xs mx-auto">
              When a friend misses a habit, it&apos;ll show up here so you can
              send encouragement.
            </p>
          </div>
        )}
      </div>
      {ToastElements}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partnership sections
// ---------------------------------------------------------------------------

/**
 * Invitations and requests render identically — same row, same two buttons.
 * Only the sentence differs, which the caller supplies, so the two sections
 * cannot drift apart in layout while saying different things.
 */
function PartnerSection({
  title,
  subtitle,
  icon: Icon,
  items,
  respondingId,
  onRespond,
  acceptLabel,
  describe,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  items: PartnerInboxItem[];
  respondingId: string | null;
  onRespond: (item: PartnerInboxItem, accept: boolean) => void;
  acceptLabel: string;
  describe: (item: PartnerInboxItem) => React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-text-tertiary" />
        <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">
          {title}
        </h2>
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)] -mt-1">
        {subtitle}
      </p>

      <div className="space-y-2">
        {items.map((item) => {
          const isBusy = respondingId === item.shareId;
          return (
            <div
              key={item.shareId}
              className="habit-tint flex items-center gap-3 rounded-lg border p-3"
              style={{ ["--habit-color" as string]: item.habitColor }}
            >
              <Avatar
                src={item.person.avatar_url}
                name={item.person.display_name}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                  {item.person.display_name}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] truncate">
                  {describe(item)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onRespond(item, false)}
                  disabled={isBusy}
                  className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors disabled:opacity-50"
                  aria-label={`Decline ${item.person.display_name}`}
                >
                  <X className="w-4 h-4" />
                </button>
                <Button
                  size="sm"
                  loading={isBusy}
                  disabled={isBusy}
                  onClick={() => onRespond(item, true)}
                >
                  {acceptLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
