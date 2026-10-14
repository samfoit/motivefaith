"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CalendarDays, CalendarRange, Check, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DashboardView } from "@/lib/constants/dashboard-view";
import { TOP_BAR_ICON_BUTTON_CLASS } from "@/components/layout/topBarStyles";

/**
 * Day / week / month switcher, tucked behind one icon.
 *
 * It used to be a full-width segmented control above the list. People settle
 * on a view and rarely change it, so it cost a row of the first screen on
 * every visit for something used once in a while. The trigger's icon shows
 * the current view, so the choice is still visible without the row.
 */
const VIEWS: {
  value: DashboardView;
  label: string;
  hint: string;
  Icon: typeof ListTodo;
}[] = [
  { value: "day", label: "Day", hint: "Today's habits", Icon: ListTodo },
  { value: "week", label: "Week", hint: "Seven-day grid", Icon: CalendarRange },
  { value: "month", label: "Month", hint: "This month at a glance", Icon: CalendarDays },
];

interface ViewMenuProps {
  value: DashboardView;
  onChange: (view: DashboardView) => void;
}

export function ViewMenu({ value, onChange }: ViewMenuProps) {
  const current = VIEWS.find((v) => v.value === value) ?? VIEWS[0];
  const TriggerIcon = current.Icon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Change view (currently ${current.label.toLowerCase()})`}
        className={cn(
          TOP_BAR_ICON_BUTTON_CLASS,
          "data-[state=open]:bg-surface-hover data-[state=open]:text-text-primary",
        )}
      >
        <TriggerIcon className="w-5 h-5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="view-menu z-50 min-w-52 rounded-lg bg-elevated p-1 shadow-lg border border-bg-secondary"
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(v) => onChange(v as DashboardView)}
          >
            {VIEWS.map(({ value: v, label, hint, Icon }) => (
              <DropdownMenu.RadioItem
                key={v}
                value={v}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2.5 py-2 cursor-pointer select-none outline-none",
                  "text-text-primary data-[highlighted]:bg-surface-hover",
                )}
              >
                <Icon className="w-4 h-4 shrink-0 text-text-secondary" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-text-tertiary">{hint}</span>
                </span>
                <DropdownMenu.ItemIndicator>
                  <Check className="w-4 h-4 text-brand" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
