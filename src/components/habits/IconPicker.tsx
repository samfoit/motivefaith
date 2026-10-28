"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { HABIT_EMOJIS } from "@/lib/constants/habit";
import { SCROLL_ROW_CLASS, useScrollRow } from "@/lib/hooks/useScrollRow";

/** One 44px row of icons plus the 4px above and below it for the ring. */
const STRIP_HEIGHT = 52;

interface IconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  className?: string;
}

/**
 * The habit's icon: one row, with the whole set a tap away.
 *
 * It used to be every icon at once, an eight-column grid four rows deep, a
 * quarter of a phone screen for a choice most people make once. Now it is a
 * single strip that scrolls like the color row under it, and "Show all"
 * unfolds the same icons into a grid for scanning. Picking from the grid folds
 * it back up, the way a menu closes, and the pick slides into view in the
 * strip.
 *
 * Strip and grid are the same element, so nothing remounts between them. The
 * fold runs on the grid; only once the space has closed up to one row does it
 * turn back into the strip, whose first icons sit where the grid's first row
 * was.
 */
export function IconPicker({ value, onChange, className }: IconPickerProps) {
  // A habit can carry an icon from outside the set — an older one, or one a
  // challenge gave it. It leads the row, and stays there after another pick,
  // so editing never strands the habit's own icon. Followed rather than read
  // once: the edit sheet resets its form just after it opens.
  const [outside, setOutside] = useState(
    HABIT_EMOJIS.includes(value) ? null : value,
  );
  if (!HABIT_EMOJIS.includes(value) && value !== outside) setOutside(value);
  const icons = outside ? [outside, ...HABIT_EMOJIS] : HABIT_EMOJIS;
  const [expanded, setExpanded] = useState(false);
  // Outlasts `expanded` by the length of the fold.
  const [gridShown, setGridShown] = useState(false);
  const { ref: rowRef, rowProps } = useScrollRow();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const labelId = useId();
  const panelId = useId();

  const open = () => {
    setGridShown(true);
    setExpanded(true);
  };

  const close = () => {
    // A pick made from the keyboard would otherwise leave focus on a cell
    // that is about to stop being one.
    if (rowRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus({ preventScroll: true });
    }
    setExpanded(false);
  };

  // Keep the pick in view in the strip: once on mount, and after each fold.
  // Scrolled by hand: scrollIntoView would also move the page to the row.
  useEffect(() => {
    if (gridShown) return;
    const row = rowRef.current;
    const cell = row?.children[icons.indexOf(value)] as HTMLElement | undefined;
    if (!row || !cell) return;
    const inView =
      cell.offsetLeft >= row.scrollLeft &&
      cell.offsetLeft + cell.offsetWidth <= row.scrollLeft + row.clientWidth;
    if (inView) return;
    row.scrollTo({
      left: cell.offsetLeft - (row.clientWidth - cell.offsetWidth) / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
    // Not on every pick: a tap in the strip is already in view, and chasing
    // it would fight the swipe that found it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridShown]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <p id={labelId} className="text-xs font-medium text-text-secondary">
          Icon
        </p>
        <button
          ref={toggleRef}
          type="button"
          onClick={expanded ? close : open}
          aria-expanded={expanded}
          aria-controls={panelId}
          // The padding is the tap area; the negative margin keeps the label
          // on the line and the chevron on the gutter.
          className={cn(
            "-my-2 -mr-2 inline-flex items-center gap-1 rounded-md px-2 py-2",
            "text-xs font-medium text-brand-ink",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
          )}
        >
          {expanded ? "Show less" : "Show all"}
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {/* -mx-1 with the row's px-1: room for the selection ring, which the
          clip would otherwise slice off the first and last icons. */}
      <motion.div
        id={panelId}
        initial={false}
        animate={{ height: expanded ? "auto" : STRIP_HEIGHT }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
        }
        onAnimationComplete={() => {
          if (!expanded) setGridShown(false);
        }}
        className="-mx-1 overflow-hidden"
      >
        <div
          {...rowProps}
          role="group"
          aria-labelledby={labelId}
          className={cn(
            // `relative` makes the row the cells' offsetParent, which the
            // scroll-into-view above measures against.
            "relative gap-2 p-1",
            gridShown
              ? "grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))]"
              : SCROLL_ROW_CLASS,
          )}
        >
          {icons.map((emoji) => {
            const selected = value === emoji;
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onChange(emoji);
                  if (expanded) close();
                }}
                className={cn(
                  "flex items-center justify-center rounded-lg text-2xl leading-none",
                  "transition-[transform,background-color] duration-150 active:scale-90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
                  gridShown ? "w-full aspect-square" : "w-11 h-11 shrink-0",
                  selected
                    ? "bg-brand-light ring-2 ring-brand-ink"
                    : "hover:bg-surface-hover",
                )}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
