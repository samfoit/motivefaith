import { Check, CloudRain } from "lucide-react";
import type { DayState } from "./day-state";

/** The mark for one habit on one day, in the week grid and the month's day list. */
export function DayMark({ state }: { state: DayState }) {
  switch (state) {
    case "done":
      return (
        <span className="w-5 h-5 rounded-full bg-brand flex items-center justify-center">
          <Check className="w-3 h-3 text-on-brand" strokeWidth={3} />
        </span>
      );
    case "rain":
      return (
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center"
          style={{
            color: "var(--color-rain)",
            backgroundColor:
              "color-mix(in srgb, var(--color-rain) 18%, transparent)",
          }}
        >
          <CloudRain className="w-3 h-3" strokeWidth={2.5} />
        </span>
      );
    case "missed":
      return <span className="w-5 h-5 rounded-full border-[1.5px] border-text-tertiary" />;
    case "today":
      return <span className="w-5 h-5 rounded-full border-2 border-brand-ink" />;
    case "upcoming":
      return (
        <span className="w-5 h-5 rounded-full border-[1.5px] border-text-tertiary opacity-35" />
      );
    case "off":
      return <span className="w-1 h-1 rounded-full bg-text-tertiary opacity-60" />;
  }
}

export function DayMarkLegendItem({ state, label }: { state: DayState; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-5 h-5 flex items-center justify-center scale-75">
        <DayMark state={state} />
      </span>
      {label}
    </span>
  );
}
