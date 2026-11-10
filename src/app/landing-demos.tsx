"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Check, Clock, CloudRain, CornerDownRight, Flame, Heart, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { HabitCircle, HabitTitleRow, habitSurfaceProps, type HabitCircleState } from "@/components/habits/HabitCardParts";
import {
  CheckInDrawerOptions,
  DrawerHandle,
  DRAWER_SURFACE_CLASS,
  DRAWER_SURFACE_STYLE,
  peekDrawer,
  useCheckInDrawer,
} from "@/components/habits/CheckInDrawer";
import { useHabitDrawerStore } from "@/lib/stores/habit-drawer-store";
import { CHECK_IN_OPTIONS, type CheckInAction } from "@/lib/constants/check-in";
import { RAIN_CHECK_REASONS, RAIN_CHECK_REASON_LABELS, type RainCheckReason } from "@/lib/constants/rain-check";
import { bubbleCorners } from "@/components/social/ChatParts";
import { palette } from "@/lib/lamplight/palette";
import { SkyBand, SkyStarField } from "@/components/sky/SkyDrawing";

/*
 * The landing page's demos: the app's own habit card, drawer, rain check and
 * palette, played with rather than described. Nothing here talks to the
 * server; every state is local and resets.
 */

/** True once the element has been on screen; it stays true. */
function useSeen(ref: React.RefObject<HTMLElement | null>, threshold = 0.4) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}

/** Whether the element is on screen now. Unlike useSeen, it goes false again. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>, threshold = 0.4) {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return onScreen;
}

/** A habit card at rest: the dashboard card's look, without its gestures. */
function DemoHabitCard({
  emoji,
  title,
  color,
  streak,
  state,
  time,
  pill,
}: {
  emoji: string;
  title: string;
  color: string | null;
  streak: number;
  state: HabitCircleState;
  time: string;
  pill?: React.ReactNode;
}) {
  const surface = habitSurfaceProps(color, { className: "gap-3 pl-4 pr-4" });
  return (
    <div {...surface}>
      <HabitCircle state={state} animateDone />
      <div className="flex-1 min-w-0">
        <HabitTitleRow emoji={emoji} title={title} streak={streak} muted={state !== "open"} titleAs="span" />
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-xs text-text-secondary flex items-center gap-0.5">
            <Clock className="w-3 h-3" aria-hidden />
            {time}
          </span>
          {pill}
        </div>
      </div>
    </div>
  );
}

/** The rain-blue status pill a habit card wears once it is rain-checked. */
function RainPill({ movedTo }: { movedTo: string | null }) {
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
      style={{
        color: "var(--color-rain)",
        backgroundColor: "color-mix(in srgb, var(--color-rain) 14%, transparent)",
      }}
    >
      <CloudRain className="w-2.5 h-2.5" aria-hidden />
      {movedTo ? `Moved to ${movedTo}` : "Rain check"}
    </span>
  );
}

/** The frame each demo plays in: the app's tile ground, edge to edge on a phone. */
function DemoStage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative -mx-4 sm:mx-0 sm:rounded-lg border-y sm:border bg-bg-secondary p-4 sm:p-6",
        className,
      )}
      style={{ borderColor: "var(--color-border)" }}
    >
      {children}
    </div>
  );
}

/* ── Proof: check in, and a partner sees it ───────────────────────────── */

const RUN = { emoji: "\u{1F3C3}", title: "Morning run", color: "#14B8A6", streak: 14 };
/** The drawer store's key for this card; nothing else on the page has one. */
const DEMO_HABIT_ID = "landing-demo-run";
const DRAWER_ID = "landing-demo-drawer";
/** How many times the card shows its gesture before it leaves it to you. */
const PEEKS = 3;
/** From the start of one showing to the next: the peek, then a breath. */
const PEEK_EVERY_MS = 4500;

/** A voice note's waveform, fixed so the server and the client agree. */
const WAVE = [6, 10, 16, 9, 20, 14, 24, 12, 18, 8, 22, 15, 10, 19, 13, 7, 16, 11, 6, 9];

export function ProofDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stageRef, 0.6);
  const [sent, setSent] = useState<CheckInAction | null>(null);
  /** 1: the check-in lands, 2: Alex hearts it, 3: Alex writes back. */
  const [step, setStep] = useState(0);

  const drawerRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<Animation[]>([]);
  /** Showings played so far, and whether the visitor has taken over. */
  const lesson = useRef({ peeks: 0, done: false });
  /** A touch that caught the card mid-peek, and the icon under it if any. */
  const hold = useRef<{ held: boolean; under: CheckInAction | null }>({ held: false, under: null });

  // The dashboard card's own drawer: swipe or drag it, tap the handle, and
  // Escape or a tap elsewhere puts it back.
  const { isOpen, toggle, close, trackRef, surfaceRef, dragRef, consumeDragClick, trackHandlers } =
    useCheckInDrawer({ habitId: DEMO_HABIT_ID, enabled: sent === null, optionCount: CHECK_IN_OPTIONS.length });

  const icons = useCallback(
    () => [...(drawerRef.current?.querySelectorAll<HTMLElement>(".hc-option") ?? [])],
    [],
  );

  /**
   * The visitor takes over, and the showings stop. A card caught mid-peek
   * stays exactly where the touch found it, its icons with it, instead of
   * snapping back from under the finger: a swipe carries on from there, a
   * tap on the arrow opens the drawer from there, and a tap on an icon it
   * uncovered checks in with it. Returns how far aside the card is held and
   * which uncovered icon, if any, is under the touch.
   */
  const takeOver = useCallback(
    (x?: number, y?: number) => {
      lesson.current.done = true;
      const running = peekRef.current;
      peekRef.current = [];
      const surface = surfaceRef.current;
      if (!surface || running[0]?.playState !== "running") {
        for (const a of running) a.cancel();
        return { held: 0, under: null };
      }
      surface.style.transition = "none";
      for (const icon of icons()) icon.style.transitionProperty = "none";
      for (const a of running) {
        try {
          a.commitStyles();
        } catch {
          // Its element is gone: nothing to hold.
        }
        a.cancel();
      }
      const transform = getComputedStyle(surface).transform;
      const held = transform && transform !== "none" ? Math.max(0, -new DOMMatrixReadOnly(transform).m41) : 0;
      let under: CheckInAction | null = null;
      if (x !== undefined && y !== undefined) {
        const edge = surface.getBoundingClientRect().right;
        icons().forEach((icon, i) => {
          const r = icon.getBoundingClientRect();
          const uncovered = r.left >= edge - 8 && Number(getComputedStyle(icon).opacity) > 0.5;
          if (uncovered && x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) {
            under = CHECK_IN_OPTIONS[i].action;
          }
        });
      }
      return { held, under };
    },
    [surfaceRef, icons],
  );

  /** Hands a held card and its icons back to the drawer's own state. */
  const letGo = useCallback(() => {
    const open = useHabitDrawerStore.getState().openHabitId === DEMO_HABIT_ID;
    for (const icon of icons()) {
      icon.style.transitionProperty = "";
      icon.style.removeProperty("transform");
      icon.style.opacity = open ? "1" : "0";
    }
    const surface = surfaceRef.current;
    if (surface && !open && !dragRef.current.active) {
      surface.style.transition = "";
      surface.style.transform = "";
    }
  }, [icons, surfaceRef, dragRef]);

  const pick = (action: CheckInAction) => {
    takeOver();
    close();
    setSent(action);
    setStep(1);
  };

  /** Lets the drag, click or pick that ends a held touch land, then lets go. */
  const release = (e: React.PointerEvent<HTMLDivElement>, end: (e: React.PointerEvent) => void) => {
    const dragged = dragRef.current.locked;
    end(e);
    const { held, under } = hold.current;
    hold.current = { held: false, under: null };
    if (!held) return;
    if (under && !dragged && e.type === "pointerup") pick(under);
    setTimeout(letGo, 120);
  };

  const handlers = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      const { held, under } = takeOver(e.clientX, e.clientY);
      trackHandlers.onPointerDown(e);
      hold.current = { held: held > 0, under };
      // A swipe picks the card up from where the peek held it.
      if (held > 0 && dragRef.current.active) dragRef.current.base = held;
    },
    onPointerMove: trackHandlers.onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => release(e, trackHandlers.onPointerUp),
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => release(e, trackHandlers.onPointerCancel),
  };

  // The card shows what to do rather than a line of text saying it. On a
  // touchscreen it slides aside on its own, the ways to check in come out
  // from under it, and it settles back: the dashboard's first-run peek, a
  // few times while the demo is on screen and untouched. An open drawer
  // there would snap shut at the next touch, most likely a scroll. With a
  // mouse nothing closes it by accident, so it simply opens; without motion
  // it opens too, at once, rather than slide anything.
  useEffect(() => {
    if (!onScreen || sent !== null) return;
    const lessonNow = lesson.current;
    if (lessonNow.done || lessonNow.peeks >= PEEKS) return;
    const drawers = useHabitDrawerStore.getState();

    if (
      window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const open = setTimeout(() => {
        lessonNow.done = true;
        drawers.open(DEMO_HABIT_ID);
      }, 450);
      return () => clearTimeout(open);
    }

    let next: ReturnType<typeof setTimeout>;
    const show = () => {
      if (lessonNow.done || lessonNow.peeks >= PEEKS) return;
      const surface = surfaceRef.current;
      const drawer = drawerRef.current;
      const busy =
        document.visibilityState !== "visible" ||
        dragRef.current.active ||
        useHabitDrawerStore.getState().openHabitId === DEMO_HABIT_ID;
      if (surface && drawer && !busy) {
        lessonNow.peeks += 1;
        peekRef.current = peekDrawer(surface, drawer);
      }
      next = setTimeout(show, PEEK_EVERY_MS);
    };
    next = setTimeout(show, lessonNow.peeks === 0 ? 450 : 1200);
    return () => clearTimeout(next);
  }, [onScreen, sent, surfaceRef, dragRef]);

  useEffect(() => {
    if (!sent) return;
    const heart = setTimeout(() => setStep(2), 1100);
    const reply = setTimeout(() => setStep(3), 2100);
    return () => {
      clearTimeout(heart);
      clearTimeout(reply);
    };
  }, [sent]);

  const rain = sent === "rain_check";
  const done = sent !== null && !rain;

  function reset() {
    setSent(null);
    setStep(0);
    useHabitDrawerStore.getState().open(DEMO_HABIT_ID);
  }

  return (
    <DemoStage>
      <div ref={stageRef}>
        {/* The card, its drawer behind it */}
        <div
          ref={trackRef}
          {...handlers}
          className="hc-drawer relative overflow-hidden rounded-lg"
          style={{ ["--habit-color" as string]: RUN.color, touchAction: "pan-y" } as React.CSSProperties}
        >
          <CheckInDrawerOptions
            ref={drawerRef}
            id={DRAWER_ID}
            habitTitle={RUN.title}
            options={CHECK_IN_OPTIONS}
            isOpen={isOpen && sent === null}
            onPick={(action) => {
              if (consumeDragClick()) return;
              pick(action);
            }}
          />
          <div
            ref={surfaceRef}
            {...habitSurfaceProps(RUN.color, {
              className: cn(DRAWER_SURFACE_CLASS, "gap-3 pl-4 pr-2 select-none"),
              style: DRAWER_SURFACE_STYLE,
            })}
          >
            {/* The circle checks in, as on the dashboard. Once anything is
                sent the demo takes no more until "Try another". */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (consumeDragClick() || sent !== null) return;
                pick("quick");
              }}
              // aria-disabled rather than disabled: a disabled button swallows
              // the pointer events a drag starting on it needs.
              aria-disabled={sent !== null}
              aria-label={
                done ? `${RUN.title} completed` : rain ? `${RUN.title} rain-checked today` : `Complete ${RUN.title}`
              }
              className={cn(
                // after: stretches the 40px circle's tap area to 48px.
                "group relative shrink-0 rounded-full after:absolute after:-inset-1",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-ink",
                sent === null && "active:scale-90 transition-transform",
              )}
            >
              <HabitCircle state={done ? "done" : rain ? "rain" : "open"} animateDone />
            </button>
            <div className="flex-1 min-w-0">
              <HabitTitleRow
                emoji={RUN.emoji}
                title={RUN.title}
                streak={done ? RUN.streak + 1 : RUN.streak}
                muted={sent !== null}
                titleAs="span"
              />
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-text-secondary flex items-center gap-0.5">
                  <Clock className="w-3 h-3" aria-hidden />
                  6:30 AM
                </span>
                {rain && <RainPill movedTo={null} />}
              </div>
            </div>
            {sent === null ? (
              <DrawerHandle
                isOpen={isOpen}
                drawerId={DRAWER_ID}
                habitTitle={RUN.title}
                onToggle={() => {
                  if (consumeDragClick()) return;
                  // From the keyboard too: no showing runs over an opening drawer.
                  takeOver();
                  toggle();
                }}
                className="-my-1"
              />
            ) : (
              <div className="shrink-0 w-7" aria-hidden />
            )}
          </div>
        </div>

        {/* Alex's side of it: a name until there is a conversation to rule off */}
        <div className="mt-6">
          <div
            className={cn("flex items-center gap-2", sent && "pb-3 border-b")}
            style={{ borderColor: "var(--color-border)" }}
          >
            <Avatar name="Alex Rivera" size="sm" />
            <span className="text-sm font-medium">Alex</span>
          </div>

          {/* Empty until you check in, so it costs no room before then.
              It makes all its room at the tap, Alex's reply and the reset
              included, so nothing on the page moves again as they arrive. */}
          <div className={cn("flex flex-col gap-3", sent && "pt-4")} aria-live="polite">
            {sent && (
              <div className="self-end relative landing-demo-in">
                <SentCheckIn action={sent} />
                {step >= 2 && (
                  <span
                    className="absolute -bottom-2.5 left-3 h-6 px-1.5 rounded-full border bg-bg-elevated flex items-center text-miss landing-demo-pop"
                    style={{ borderColor: "var(--color-border)" }}
                    role="img"
                    aria-label="Alex hearted it"
                  >
                    <Heart className="w-3.5 h-3.5" fill="currentColor" aria-hidden />
                  </span>
                )}
              </div>
            )}

            {sent && (
              <div
                className={cn(
                  "chat-bubble self-start max-w-[80%] px-3.5 py-2 text-sm mt-2",
                  bubbleCorners(false, true),
                  step >= 3 ? "landing-demo-in" : "invisible",
                )}
              >
                {rain ? "Rest up. Tomorrow\u2019s a new day \u{1F64F}" : "So proud of you! \u{1F64C}"}
              </div>
            )}
          </div>

          {sent && (
            <button
              type="button"
              onClick={reset}
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 min-h-11 text-sm font-medium text-brand-ink rounded-md focus-visible:outline-2 focus-visible:outline-brand-ink",
                step >= 3 ? "landing-demo-in" : "invisible",
              )}
            >
              <RotateCcw className="w-4 h-4" aria-hidden />
              Try another
            </button>
          )}
        </div>
      </div>
    </DemoStage>
  );
}

/** Your check-in as it lands in the chat: the habit's card, with its proof. */
function SentCheckIn({ action }: { action: CheckInAction }) {
  const rain = action === "rain_check";
  const photo = action === "content";
  return (
    <div
      className={cn(
        "overflow-hidden border",
        photo ? "w-64" : "w-fit min-w-56",
        bubbleCorners(true, true),
        rain ? "chat-bubble border-dashed" : "habit-tint",
      )}
      style={
        rain
          ? { borderColor: "color-mix(in oklab, var(--color-rain) 55%, transparent)" }
          : ({
              ["--habit-color" as string]: RUN.color,
              borderColor: "color-mix(in oklab, var(--habit-color) 45%, var(--color-bg-elevated))",
            } as React.CSSProperties)
      }
    >
      {photo && <ProofPhoto />}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none"
          style={{
            backgroundColor: rain
              ? "color-mix(in oklab, var(--color-rain) 14%, transparent)"
              : "color-mix(in oklab, var(--habit-color) 18%, transparent)",
          }}
          aria-hidden
        >
          {RUN.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{RUN.title}</p>
          {rain ? (
            <p className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-rain)" }}>
              <CloudRain className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Rain check
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              Checked in
            </p>
          )}
        </div>
      </div>
      {action === "voice" && (
        <div className="px-3 pb-3 flex items-center gap-2.5">
          <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: "var(--color-checkin-voice)" }} aria-hidden>
            <Play className="w-3.5 h-3.5 translate-x-px" fill="currentColor" />
          </span>
          <span className="flex items-center gap-[3px] h-6" aria-hidden>
            {WAVE.map((h, i) => (
              <span key={i} className="w-[3px] rounded-full" style={{ height: h, backgroundColor: "var(--color-checkin-voice)" }} />
            ))}
          </span>
          <span className="text-xs tabular-nums text-text-secondary">0:14</span>
          <span className="sr-only">Voice note, 14 seconds</span>
        </div>
      )}
      {action === "message" && (
        <p className="-mt-0.5 px-3 pb-3 text-sm leading-snug text-text-primary max-w-[30ch]">
          Three miles before work. Slow, but I went.
        </p>
      )}
      {rain && (
        <p className="-mt-0.5 px-3 pb-3 text-sm text-text-secondary">{RAIN_CHECK_REASON_LABELS.rest}</p>
      )}
    </div>
  );
}

/** The run's photo: a sunrise over the hills, drawn in that hour's palette. */
function ProofPhoto() {
  const hour = 6.5;
  return (
    <div
      role="img"
      aria-label="Photo of a sunrise over the hills"
      className="relative aspect-[390/220] overflow-hidden"
      style={{
        ...palette(hour).vars,
        background: "linear-gradient(to bottom, var(--color-header), var(--color-bg-primary))",
      } as React.CSSProperties}
    >
      <SkyBand hour={hour} idPrefix="proof-photo" className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/* ── Grace: a rain check holds the streak ─────────────────────────────── */

const SCRIPTURE = { emoji: "\u{1F4D6}", title: "Read Scripture", color: "#6366F1", streak: 12 };
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const TODAY = 3;
const MOVE_DAYS = [4, 5, 6] as const;

export function GraceDemo() {
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [planMove, setPlanMove] = useState(false);
  const [reason, setReason] = useState<RainCheckReason | null>("rest");
  const [taken, setTaken] = useState(false);

  const movedName = planMove && moveTo !== null ? WEEK[moveTo] : null;
  const movedLong = movedName ? fullDay(movedName) : null;

  function reset() {
    setTaken(false);
    setPlanMove(false);
    setMoveTo(null);
    setReason("rest");
  }

  return (
    <DemoStage>
      {/* This week, today included */}
      <ol className="grid grid-cols-7 gap-1 mb-4" aria-label="This week">
        {WEEK.map((day, i) => {
          const past = i < TODAY;
          const today = i === TODAY;
          const promised = taken && movedName !== null && i === moveTo;
          const state: HabitCircleState | null = past ? "done" : today && taken ? "rain" : today ? "open" : null;
          return (
            <li key={day} className="flex flex-col items-center gap-1.5">
              <span className={cn("text-[11px] font-medium", today ? "text-brand-ink" : "text-text-tertiary")}>
                {today ? "Today" : day.slice(0, 1)}
              </span>
              {state ? (
                <HabitCircle state={state} size="sm" />
              ) : (
                <span
                  className={cn("w-7 h-7 rounded-full", promised ? "border-2 border-dashed" : "bg-surface-hover")}
                  style={promised ? { borderColor: "var(--color-rain)" } : undefined}
                />
              )}
              <span className="sr-only">
                {past ? `${day}: done` : today ? (taken ? "Today: rain check" : "Today: not done yet") : promised ? `${day}: moved here` : day}
              </span>
            </li>
          );
        })}
      </ol>

      <DemoHabitCard
        emoji={SCRIPTURE.emoji}
        title={SCRIPTURE.title}
        color={SCRIPTURE.color}
        streak={SCRIPTURE.streak}
        state={taken ? "rain" : "open"}
        time="9:00 PM"
        pill={taken ? <RainPill movedTo={movedLong} /> : undefined}
      />

      {!taken ? (
        <div className="mt-4 rounded-lg border bg-bg-elevated p-4" style={{ borderColor: "var(--color-border)" }}>
          <p className="font-display text-lg font-medium mb-3">Rain check</p>

          <div role="radiogroup" aria-label="What happens to it?" className="flex flex-wrap gap-1.5 mb-3">
            {[
              { move: false, label: "Just skip today", icon: CloudRain },
              { move: true, label: "Move it", icon: CornerDownRight },
            ].map((o) => {
              const selected = planMove === o.move;
              return (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setPlanMove(o.move);
                    if (o.move && moveTo === null) setMoveTo(5);
                  }}
                  className={cn(rainChoice(selected), "flex-auto whitespace-nowrap")}
                  style={selected ? RAIN_SELECTED : undefined}
                >
                  <o.icon className="w-4 h-4 shrink-0" aria-hidden />
                  {o.label}
                </button>
              );
            })}
          </div>

          {planMove && (
            <div role="radiogroup" aria-label="Which day?" className="grid grid-cols-3 gap-1.5 mb-3">
              {MOVE_DAYS.map((d) => {
                const selected = moveTo === d;
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMoveTo(d)}
                    className={cn(rainChoice(selected), "justify-center")}
                    style={selected ? RAIN_SELECTED : undefined}
                  >
                    {WEEK[d]}
                  </button>
                );
              })}
            </div>
          )}

          <p id="grace-why" className="text-xs font-medium text-text-secondary mb-2">
            Why? (optional)
          </p>
          <div role="group" aria-labelledby="grace-why" className="flex flex-wrap gap-1.5 mb-4">
            {RAIN_CHECK_REASONS.map((r) => {
              const selected = reason === r.code;
              return (
                <button
                  key={r.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setReason(selected ? null : r.code)}
                  className={cn(rainChoice(selected), "rounded-full px-3")}
                  style={selected ? RAIN_SELECTED : undefined}
                >
                  <r.icon className="w-4 h-4 shrink-0" aria-hidden />
                  {r.label}
                </button>
              );
            })}
          </div>

          <Button className="w-full" size="lg" onClick={() => setTaken(true)}>
            {movedLong ? `Move to ${movedLong}` : "Take rain check"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 landing-demo-in" aria-live="polite">
          <div className="flex items-baseline gap-3">
            <Flame className="w-8 h-8 self-center" style={{ color: "var(--color-streak)" }} aria-hidden />
            <span className="font-mono text-5xl font-bold leading-none" style={{ color: "var(--color-streak)" }}>
              {SCRIPTURE.streak}
            </span>
            <span className="text-base font-medium">
              {movedLong ? `days. Holds if you read on ${movedLong}.` : "days, and the streak holds."}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-2 mb-2">
            <Avatar name="Alex Rivera" size="xs" />
            <span className="text-xs text-text-secondary">What Alex sees</span>
          </div>
          <div
            className={cn("chat-bubble border-dashed w-fit min-w-56 overflow-hidden", bubbleCorners(false, true))}
            style={{ borderColor: "color-mix(in oklab, var(--color-rain) 55%, transparent)" }}
          >
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none"
                style={{ backgroundColor: "color-mix(in oklab, var(--color-rain) 14%, transparent)" }}
                aria-hidden
              >
                {SCRIPTURE.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{SCRIPTURE.title}</p>
                <p className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--color-rain)" }}>
                  <CloudRain className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {movedLong ? `Moved to ${movedLong}` : "Rain check"}
                </p>
              </div>
            </div>
            <p className="-mt-0.5 px-3 pb-3 text-sm text-text-secondary">
              {RAIN_CHECK_REASON_LABELS[reason ?? "other"]}
            </p>
          </div>

          <button
            type="button"
            onClick={reset}
            className="mt-4 inline-flex items-center gap-1.5 min-h-11 text-sm font-medium text-brand-ink rounded-md focus-visible:outline-2 focus-visible:outline-brand-ink"
          >
            <RotateCcw className="w-4 h-4" aria-hidden />
            Try it again
          </button>
        </div>
      )}
    </DemoStage>
  );
}

const RAIN_SELECTED: React.CSSProperties = {
  color: "var(--color-rain)",
  borderColor: "var(--color-rain)",
  backgroundColor: "color-mix(in srgb, var(--color-rain) 12%, transparent)",
};

/** A choice in the rain check sheet, the sheet's own selected look. */
function rainChoice(selected: boolean) {
  return cn(
    "min-h-11 flex items-center gap-2 rounded-lg px-3 border text-sm text-left transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ink",
    selected ? "font-medium" : "border-[var(--color-surface-hover)] text-text-secondary hover:bg-surface-hover",
  );
}

function fullDay(short: string) {
  return { Fri: "Friday", Sat: "Saturday", Sun: "Sunday" }[short] ?? short;
}

/* ── The hours: drag through the day ──────────────────────────────────── */

/** The five hours the palette passes through, each with its verse (NIV). */
const HOURS = [
  { hour: 5, name: "Before dawn", verse: "…while it was still dark, Jesus got up, left the house and went off to a solitary place, where he prayed.", ref: "Mark 1:35" },
  { hour: 6.5, name: "Sunrise", verse: "They are new every morning; great is your faithfulness.", ref: "Lamentations 3:23" },
  { hour: 13, name: "Midday", verse: "Look at the birds of the air.", ref: "Matthew 6:26" },
  { hour: 19.5, name: "Dusk", verse: "Stay with us, for it is nearly evening; the day is almost over.", ref: "Luke 24:29" },
  { hour: 21.5, name: "Night", verse: "…the moon and the stars, which you have set in place.", ref: "Psalm 8:3" },
] as const;

/** Which of the five an hour belongs to. */
function hourStop(h: number) {
  if (h >= 3.5 && h < 6.25) return HOURS[0];
  if (h >= 6.25 && h < 9) return HOURS[1];
  if (h >= 9 && h < 17.5) return HOURS[2];
  if (h >= 17.5 && h < 20.5) return HOURS[3];
  return HOURS[4];
}

function clockOf(h: number) {
  const mins = Math.round(h * 60) % (24 * 60);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** The dashboard's greeting for an hour. */
function greetingAt(h: number) {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The slider's track: the whole day's header color, hour by hour. */
const DAY_RIBBON = `linear-gradient(to right, ${Array.from({ length: 25 }, (_, i) => {
  const c = palette(i % 24).vars["--color-header"];
  return `${c} ${(i / 24) * 100}%`;
}).join(", ")})`;

/** The habit on the hour demo's dashboard: done a quarter hour after 6 PM. */
const JOURNAL = { emoji: "\u{1F4D3}", title: "Journal", at: 18, doneAt: 18.25, streak: 12 };

const SWEEP_FROM = 5;
const SWEEP_TO = 19.5;
const SWEEP_MS = 5200;

export function HourDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref, 0.35);
  const [hour, setHour] = useState(SWEEP_FROM);
  const touched = useRef(false);

  // Once, on first sight: run the day from before dawn to dusk, so the change
  // is seen before anyone touches the slider. Any touch stops it.
  useEffect(() => {
    if (!seen || touched.current) return;
    let raf = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(() => setHour(SWEEP_TO));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now: number) => {
      if (touched.current) return;
      const t = Math.min(1, (now - start) / SWEEP_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setHour(SWEEP_FROM + (SWEEP_TO - SWEEP_FROM) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen]);

  const pal = useMemo(() => palette(hour), [hour]);
  const stop = hourStop(hour);
  // The day's habit gets done soon after its hour, and starts the next day
  // open again, so scrubbing past it checks it off and back.
  const journalDone = hour >= JOURNAL.doneAt;

  function go(h: number) {
    touched.current = true;
    setHour(h);
  }

  // Drag across the scene to move through the day: a stage's width is twelve
  // hours, rightward is later. Locked to the horizontal the way the habit
  // drawer is, so a vertical swipe still scrolls the page.
  const drag = useRef({ active: false, locked: false, id: -1, x: 0, y: 0, base: 0, width: 1 });
  const stageHandlers = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag.current = {
        active: true,
        locked: false,
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        base: hour,
        width: e.currentTarget.clientWidth || 1,
      };
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d.active || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.locked) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
          d.active = false;
          return;
        }
        if (Math.abs(dx) < 8) return;
        d.locked = true;
        touched.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const h = d.base + (dx / d.width) * 12;
      setHour((((Math.round(h * 12) / 12) % 24) + 24) % 24);
    },
    onPointerUp() {
      drag.current.active = false;
    },
    onPointerCancel() {
      drag.current.active = false;
    },
  };

  return (
    <div ref={ref}>
      {/* The stage: everything inside wears the chosen hour's palette */}
      <div
        {...stageHandlers}
        data-theme={pal.light ? "light" : "dark"}
        className="hour-stage relative overflow-hidden -mx-4 sm:mx-0 sm:rounded-lg border-y sm:border select-none cursor-grab active:cursor-grabbing"
        style={{
          ...pal.vars,
          touchAction: "pan-y",
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
        } as React.CSSProperties}
      >
        <SkyStarField hour={hour} idPrefix="hour-demo" className="absolute inset-0 h-full w-full" />
        <SkyBand
          hour={hour}
          idPrefix="hour-demo"
          className="absolute inset-x-0 bottom-0 w-full h-[var(--band-h)] lg:h-[calc(var(--band-h)*1.4)]"
        />

        {/* Only the app's own screen is in here, so nothing on the stage
            claims to be something the app shows. Clear of the band, which is
            1.4 times taller on a wide screen: the sun and moon ride its top. */}
        <div className="relative p-4 sm:p-8 lg:p-10 [@media(max-height:500px)]:pt-4 pb-[calc(var(--band-h)-24px)]! lg:pb-[calc(var(--band-h)*1.4-16px)]!">
          <div className="mx-auto w-full max-w-sm space-y-3" aria-hidden>
            <div
              className="h-14 rounded-lg border px-4 flex items-center font-display text-xl font-medium"
              style={{ backgroundColor: "var(--color-header)", borderColor: "var(--color-border)" }}
            >
              {greetingAt(hour)}
            </div>
            <DemoHabitCard
              emoji={JOURNAL.emoji}
              title={JOURNAL.title}
              color={null}
              streak={journalDone ? JOURNAL.streak + 1 : JOURNAL.streak}
              state={journalDone ? "done" : "open"}
              time={clockOf(JOURNAL.at)}
            />
          </div>
        </div>
      </div>

      {/* The controls, on the page's own ground */}
      <div className="mt-6 flex items-baseline justify-between gap-4">
        <p className="font-display text-4xl sm:text-5xl font-medium tabular-nums tracking-tight" aria-hidden>
          {clockOf(hour)}
        </p>
        <p className="text-lg text-text-secondary">{stop.name}</p>
      </div>

      <div className="relative mt-3 h-11">
        <div
          className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full border"
          style={{ background: DAY_RIBBON, borderColor: "var(--color-border)" }}
          aria-hidden
        />
        <input
          type="range"
          min={0}
          max={23.75}
          step={0.25}
          value={hour}
          onChange={(e) => go(Number(e.target.value))}
          onPointerDown={() => (touched.current = true)}
          aria-label="Time of day"
          aria-valuetext={`${clockOf(hour)}, ${stop.name}`}
          className="hour-range absolute inset-0 w-full"
        />
      </div>

      <p className="mt-3 text-sm text-text-secondary">Or drag across the scene.</p>

      {/* The hour's verse: the page's own voice, out on the page's ground
          and in its colors, not inside the app's screen, where it would read
          as something the app sends.

          From a tablet up, all five share one grid cell, so the block is as
          tall as the longest verse and the page below holds still as the hour
          changes; they crossfade. On a phone the longest verse is five lines
          to the shortest's two, and reserving that much left a hole beside
          the next section, so there only the hour's own verse is in the flow,
          at its own height. It sits below the slider, so whatever it moves is
          never under the finger. */}
      <div className="mt-10 sm:mt-16 sm:grid max-w-2xl">
        {HOURS.map((v) => {
          const current = v.name === stop.name;
          return (
            <figure
              key={v.name}
              aria-hidden={!current}
              className={cn(
                "sm:[grid-area:1/1] sm:self-center sm:transition-opacity sm:duration-300 motion-reduce:transition-none",
                current ? "block opacity-100" : "hidden sm:block opacity-0 pointer-events-none select-none",
              )}
            >
              <blockquote className="font-display italic text-2xl sm:text-3xl leading-snug text-balance text-text-secondary">
                &ldquo;{v.verse}&rdquo;
              </blockquote>
              <figcaption className="mt-3 text-sm text-text-tertiary">{v.ref}</figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
