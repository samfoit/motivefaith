"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, HandHeart, X, UserPlus, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { PersonLateHabits, byPerson } from "@/components/social/LateHabitRow";
import { usePartnerInbox } from "@/lib/hooks/usePartnerInbox";
import { useLateHabits } from "@/lib/hooks/useLateHabits";
import { useRespondToPartner } from "@/lib/hooks/usePartnerActions";
import {
  dismissLateHabits,
  useDismissedLateHabits,
} from "@/lib/stores/late-habit-dismissals";
import { lateHabitKey, type LateHabit } from "@/lib/types/late-habits";
import type { PartnerInboxItem } from "@/lib/types/partners";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Habits a friend's card previews before "and N more": the rest are on the
 * card in their chat, a tap away.
 */
const INBOX_PREVIEW = 3;

export function InboxClient({
  lateHabits,
  partnerItems = [],
  userId = null,
}: {
  /** Friends' habits waiting on a word, as the server found them. */
  lateHabits: LateHabit[];
  partnerItems?: PartnerInboxItem[];
  userId?: string | null;
}) {
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
            ? `Now following ${item.habitTitle}`
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

  // The same query as the bell's count, so the two can't disagree, and the
  // same dismissals as each chat's card.
  const { data: late = [] } = useLateHabits(userId, { initialData: lateHabits });
  const dismissed = useDismissedLateHabits();
  // One moment for every row's "today" and "yesterday".
  const [now] = useState(() => new Date());
  // Unknown until mounted: dismissals live on the device.
  const visibleLate =
    dismissed === null ? null : late.filter((h) => !dismissed.has(lateHabitKey(h)));
  // Known on the server when there are none at all; otherwise once mounted.
  const noneLate = late.length === 0 || visibleLate?.length === 0;

  return (
    <div>
      <div className="max-w-2xl mx-auto px-3 pt-4 space-y-4">
        {/* Partnership decisions come first — they are the only thing here
            that is waiting on the user's answer, and they do not expire the
            way a late habit does. */}
        {invites.length > 0 && (
          <PartnerSection
            title="Invitations"
            subtitle="Someone wants you following their habit"
            icon={Mail}
            items={invites}
            respondingId={respondingId}
            onRespond={handleRespond}
            acceptLabel="Accept"
            describe={(item) => (
              <>
                invited you to follow{" "}
                <span className="font-medium">
                  {item.habitEmoji} {item.habitTitle}
                </span>
              </>
            )}
          />
        )}

        {requests.length > 0 && (
          <PartnerSection
            title="Follow requests"
            subtitle="Friends asking to follow your habits"
            icon={UserPlus}
            items={requests}
            respondingId={respondingId}
            onRespond={handleRespond}
            acceptLabel="Accept"
            describe={(item) => (
              <>
                asked to follow{" "}
                <span className="font-medium">
                  {item.habitEmoji} {item.habitTitle}
                </span>
              </>
            )}
          />
        )}

        {/* Friends' habits waiting on a word: each row opens their chat,
            where the same one is on its card. */}
        {visibleLate && visibleLate.length > 0 && (
          <section className="late-card-enter space-y-2">
            <div className="flex items-center gap-1.5">
              <HandHeart className="w-3.5 h-3.5 text-encourage" />
              <h2 className="text-sm font-medium text-[var(--color-text-secondary)]">
                Could use a word
              </h2>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)] -mt-1">
              Friends&apos; habits not logged yet, or missed
            </p>

            <ul className="space-y-2">
              {byPerson(visibleLate).map((person) => {
                const [first] = person;
                const shown = person.slice(0, INBOX_PREVIEW);
                return (
                  <li key={first.ownerId} className="relative rounded-lg bg-elevated shadow-sm">
                    <Link
                      href={`/main/feed/${first.ownerId}`}
                      className={cn(
                        "block rounded-lg p-3 pr-12 transition-opacity hover:opacity-80",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink",
                      )}
                    >
                      <PersonLateHabits
                        habits={shown}
                        more={person.length - shown.length}
                        now={now}
                      />
                    </Link>
                    <button
                      type="button"
                      onClick={() => dismissLateHabits(person.map(lateHabitKey))}
                      className={cn(
                        "absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full",
                        "text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)]",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink",
                      )}
                      aria-label={`Dismiss ${first.ownerName}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Empty state */}
        {noneLate && partners.length === 0 && (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-full bg-elevated shadow-sm flex items-center justify-center mx-auto mb-4">
              <Bell className="w-6 h-6 text-[var(--color-text-tertiary)]" />
            </div>
            <h2
              className="font-display font-medium text-[var(--color-text-primary)] mb-2"
              style={{ fontSize: "var(--text-xl)" }}
            >
              All caught up
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-xs mx-auto">
              When a friend&apos;s habit goes unlogged or missed, it&apos;ll
              show up here so you can remind or encourage them.
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
              className="habit-tint rounded-lg border p-3"
              style={{ ["--habit-color" as string]: item.habitColor }}
            >
              {/* The actions sit on their own row rather than beside the text.
                  Inline, they took 106px of a 336px row at 360px, leaving 148px
                  for a sentence that ends in the habit's name — so truncation
                  ate the one word you need in order to decide ("invited you to
                  follow ✅ Evenin…"). Given the full width the name survives,
                  and Decline gets to be a labelled button instead of a bare X. */}
              <div className="flex items-start gap-3">
                <Avatar
                  src={item.person.avatar_url}
                  name={item.person.display_name}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                    {item.person.display_name}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {describe(item)}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isBusy}
                  aria-label={`Decline ${item.person.display_name}`}
                  onClick={() => onRespond(item, false)}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  loading={isBusy}
                  disabled={isBusy}
                  aria-label={`${acceptLabel} ${item.person.display_name}`}
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
