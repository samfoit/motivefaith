"use client";

import React, { useState, useMemo } from "react";
import { motion } from "motion/react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { CompletionBubble, slideVariant } from "@/components/social/CompletionBubble";
import { ReportSheet } from "@/components/social/ReportSheet";
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
  const [cutoff] = useState(() => Date.now() - 24 * 60 * 60 * 1000);

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
      if (c.isMe) continue; // hearts are only relevant for friend completions

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

  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-tertiary text-center py-8">
        No activity in the last 24 hours.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {entries.map((entry) => {
          if (entry.kind === "encouragement") {
            return (
              <EncouragementBubble
                key={`e-${entry.data.id}`}
                data={entry.data}
                friendName={friendName}
              />
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
            <CompletionBubble
              key={`c-${c.id}`}
              isMe={c.isMe}
              habitEmoji={c.habit_emoji}
              habitTitle={c.habit_title}
              habitColor={c.habit_color}
              completionType={c.completion_type}
              evidenceUrl={c.evidence_url}
              notes={c.notes}
              completedAt={c.completed_at}
              heartCount={heartCount}
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
              onReport={
                !c.isMe ? () => setReportId(c.id) : undefined
              }
            />
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
    </>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EncouragementBubble({
  data,
  friendName,
}: {
  data: JourneyEncouragement;
  friendName: string;
}) {
  const actor = data.isMe ? "You" : friendName;

  return (
    <motion.div
      variants={slideVariant(data.isMe)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      className={cn("flex", data.isMe ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-xl px-3.5 py-2.5 space-y-1",
          data.isMe ? "rounded-br-sm" : "rounded-bl-sm",
        )}
        style={{
          backgroundColor: `color-mix(in srgb, var(--color-encourage) ${data.isMe ? "15%" : "10%"}, var(--color-bg-primary))`,
        }}
      >
        {/* Sender */}
        <p className="text-xs font-semibold text-encourage">{actor}</p>

        {/* Content — always shown */}
        {data.content && (
          <p
            className={cn(
              "text-text-primary",
              data.encouragement_type === "emoji" ? "text-2xl" : "text-sm",
            )}
          >
            {data.content}
          </p>
        )}

        {/* Time */}
        <p className="text-[10px] text-text-tertiary">
          {format(new Date(data.created_at), "h:mm a")}
        </p>
      </div>
    </motion.div>
  );
}
