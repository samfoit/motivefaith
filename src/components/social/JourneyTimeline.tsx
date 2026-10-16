"use client";

import React, { useState, useMemo } from "react";
import { Copy, Flag } from "lucide-react";
import { FEED_WINDOW_MS } from "@/lib/constants/limits";
import { CompletionBubble } from "@/components/social/CompletionBubble";
import { ReportSheet } from "@/components/social/ReportSheet";
import { ChatRow, MessageBubble, layoutRuns } from "@/components/social/ChatParts";
import { useToast } from "@/components/ui/Toast";
import type { JourneyCompletion, JourneyEncouragement } from "@/lib/types/feed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimelineEntry =
  | { kind: "completion"; data: JourneyCompletion; sortDate: number }
  | { kind: "encouragement"; data: JourneyEncouragement; sortDate: number };

/** Pre-computed heart state per completion (avoids O(n²) in render) */
interface HeartState {
  alreadyHearted: boolean;
  heartCount: number;
}

interface JourneyTimelineProps {
  completions: JourneyCompletion[];
  encouragements: JourneyEncouragement[];
  friendName: string;
  onHeartCompletion?: (completionId: string, isHearted: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const JourneyTimeline = React.memo(function JourneyTimeline({
  completions,
  encouragements,
  friendName,
  onHeartCompletion,
}: JourneyTimelineProps) {
  // Filter out ❤️ emoji encouragements — those render as badges on completions
  const inlineEncouragements = useMemo(
    () => encouragements.filter(
      (e) => !(e.encouragement_type === "emoji" && e.content === "❤️"),
    ),
    [encouragements],
  );

  // Only show the last 24 hours of activity
  const [cutoff] = useState(() => Date.now() - FEED_WINDOW_MS);

  // Optimistic heart tracking (additions and removals)
  const [optimisticHearts, setOptimisticHearts] = useState(new Set<string>());
  const [optimisticUnhearts, setOptimisticUnhearts] = useState(new Set<string>());

  // Report state (shared across all bubbles)
  const [reportId, setReportId] = useState<string | null>(null);

  // Merge completions + encouragements into a sorted timeline (oldest first)
  // Pre-parse all ISO strings to timestamps once to avoid repeated Date construction
  const entries = useMemo<TimelineEntry[]>(() => {
    return [
      ...completions
        .map((c) => ({
          kind: "completion" as const,
          data: c,
          sortDate: new Date(c.completed_at).getTime(),
        }))
        .filter((e) => e.sortDate >= cutoff),
      ...inlineEncouragements
        .map((e) => ({
          kind: "encouragement" as const,
          data: e,
          sortDate: new Date(e.created_at).getTime(),
        }))
        .filter((e) => e.sortDate >= cutoff),
    ].sort((a, b) => a.sortDate - b.sortDate);
  }, [completions, inlineEncouragements, cutoff]);

  // Pre-compute heart state for all completions in O(n+m)
  const heartStates = useMemo(() => {
    const hearts = encouragements.filter(
      (e) => e.encouragement_type === "emoji" && e.content === "❤️",
    );

    // Index hearts by completion_id for O(1) lookup
    const heartsByCompletion = new Map<string, typeof hearts>();
    for (const h of hearts) {
      if (h.completion_id) {
        const existing = heartsByCompletion.get(h.completion_id) ?? [];
        existing.push(h);
        heartsByCompletion.set(h.completion_id, existing);
      }
    }

    const map = new Map<string, HeartState>();
    for (const c of completions) {
      const linked = heartsByCompletion.get(c.id) ?? [];
      let alreadyHearted = false;
      let heartCount = 0;
      for (const h of linked) {
        if (h.isMe) alreadyHearted = true;
        heartCount++;
      }

      map.set(c.id, { alreadyHearted, heartCount });
    }
    return map;
  }, [completions, encouragements]);

  // Runs of one person's messages, and where a time goes between them.
  const runs = useMemo(
    () =>
      layoutRuns(
        entries.map((e) => ({ sender: e.data.isMe ? "me" : "friend", at: e.sortDate })),
      ),
    [entries],
  );

  const { show: showToast, ToastElements } = useToast();

  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-tertiary text-center py-8">
        No activity in the last 24 hours.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-clip">
        {entries.map((entry, i) => {
          const position = runs[i];

          if (entry.kind === "encouragement") {
            const e = entry.data;
            const text = e.content;
            return (
              <ChatRow
                key={`e-${e.id}`}
                isMe={e.isMe}
                position={position}
                showSender={false}
                actionsTitle={e.isMe ? "Your message" : friendName}
                actions={
                  text
                    ? [{
                        label: "Copy text",
                        icon: Copy,
                        onSelect: () => {
                          void navigator.clipboard?.writeText(text).then(
                            () => showToast({ variant: "success", title: "Copied" }),
                            () => showToast({ variant: "error", title: "Couldn't copy" }),
                          );
                        },
                      }]
                    : []
                }
              >
                <MessageBubble
                  isMe={e.isMe}
                  first={position.first}
                  content={e.content}
                  mediaPath={e.media_path}
                  mediaType={e.media_type}
                />
              </ChatRow>
            );
          }

          const c = entry.data;

          // Use pre-computed heart state (O(1) lookup instead of O(m) scan)
          const hs = heartStates.get(c.id);
          const alreadyHearted = hs?.alreadyHearted ?? false;
          const isHearted =
            optimisticUnhearts.has(c.id)
              ? false
              : alreadyHearted || optimisticHearts.has(c.id);
          const heartCount =
            (hs?.heartCount ?? 0) +
            (optimisticHearts.has(c.id) && !alreadyHearted ? 1 : 0) -
            (optimisticUnhearts.has(c.id) && alreadyHearted ? 1 : 0);

          return (
            <ChatRow
              key={`c-${c.id}`}
              isMe={c.isMe}
              position={position}
              showSender={false}
              heartCount={heartCount}
              actionsTitle={`${c.habit_emoji} ${c.habit_title}`}
              actions={
                c.isMe
                  ? []
                  : [{ label: "Report", icon: Flag, danger: true, onSelect: () => setReportId(c.id) }]
              }
            >
              <CompletionBubble
                isMe={c.isMe}
                first={position.first}
                habitEmoji={c.habit_emoji}
                habitTitle={c.habit_title}
                habitColor={c.habit_color}
                completionType={c.completion_type}
                rainCheckReason={c.rain_check_reason}
                rainCheckMovedTo={c.rain_check_moved_to}
                evidenceUrl={c.evidence_url}
                notes={c.notes}
                isHearted={isHearted}
                onHeart={
                  !c.isMe && onHeartCompletion
                    ? () => {
                      if (isHearted) {
                        setOptimisticHearts((prev) => {
                          const next = new Set(prev);
                          next.delete(c.id);
                          return next;
                        });
                        setOptimisticUnhearts(
                          (prev) => new Set(prev).add(c.id),
                        );
                      } else {
                        setOptimisticUnhearts((prev) => {
                          const next = new Set(prev);
                          next.delete(c.id);
                          return next;
                        });
                        setOptimisticHearts(
                          (prev) => new Set(prev).add(c.id),
                        );
                      }
                      onHeartCompletion(c.id, isHearted);
                    }
                    : undefined
                }
              />
            </ChatRow>
          );
        })}
      </div>

      <ReportSheet
        open={!!reportId}
        onOpenChange={(open) => {
          if (!open) setReportId(null);
        }}
        contentType="completion"
        contentId={reportId ?? ""}
      />
      {ToastElements}
    </>
  );
});
