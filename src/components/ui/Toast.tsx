import React from "react";
import * as RadixToast from "@radix-ui/react-toast";
import { cn } from "@/lib/utils/cn";

export type ToastVariant = "success" | "error" | "info" | "encourage";

export type ToastAction = {
  label: string;
  onClick: () => void;
  /** Screen-reader alternative describing how to achieve the same thing. */
  altText?: string;
};

type ToastItem = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Renders a primary button in the toast (e.g. "Undo"). */
  action?: ToastAction;
  /** Milliseconds on screen. Defaults to 3s — raise it when there's an action
   *  to take, since the toast is the only place to take it. */
  duration?: number;
};

/**
 * Each variant's hue, washed into the hour's card by .toast-tint in
 * globals.css. The hue lives in the wash and the border; the words stay in
 * the hour's ink, so they hold 5:1 or better at every hour. Done is the lamp
 * lit, so success is gold; info is plain, since blue means a rain check.
 */
const VARIANT_HUE: Record<ToastVariant, string> = {
  success: "var(--color-brand)",
  error: "var(--color-miss)",
  info: "var(--color-text-tertiary)",
  encourage: "var(--color-encourage)",
};

const TOAST_BUTTON_CLASS =
  "text-xs px-2 py-1 rounded-md text-text-primary hover:bg-text-primary/10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink";

export const ToastProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  return (
    <RadixToast.Provider swipeDirection="down">
      {children}
      <RadixToast.Viewport
        className="fixed bottom-6 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 px-4 space-y-2 outline-none"
        style={{ pointerEvents: "none" }}
      />
    </RadixToast.Provider>
  );
};

interface UseToastReturn {
  show: (opts: Omit<ToastItem, "id">) => string;
  remove: (id: string) => void;
  push: (t: Omit<ToastItem, "id">) => string;
  ToastElements: React.JSX.Element;
}

export const useToast = (): UseToastReturn => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const push = (t: Omit<ToastItem, "id">): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const item: ToastItem = { id, ...t };
    setToasts((s) => [...s, item]);
    return id;
  };

  const remove = (id: string): void => setToasts((s) => s.filter((x) => x.id !== id));

  const show = (opts: Omit<ToastItem, "id">): string => {
    return push(opts);
  };

  const ToastElements = (
    <>
      {toasts.map((t) => (
        <RadixToast.Root
          key={t.id}
          duration={t.duration ?? 3000}
          onOpenChange={(open) => {
            if (!open) remove(t.id);
          }}
          className={cn(
            "toast-tint pointer-events-auto w-full rounded-md border p-3 shadow-lg text-text-primary",
            "grid gap-1 auto-rows-max",
          )}
          style={{ ["--toast-hue" as string]: VARIANT_HUE[t.variant ?? "info"] } as React.CSSProperties}
          data-variant={t.variant ?? "info"}
        >
          {t.title && (
            <RadixToast.Title className="font-medium text-sm">
              {t.title}
            </RadixToast.Title>
          )}
          {t.description && (
            <RadixToast.Description asChild>
              <div className="text-xs text-text-secondary">{t.description}</div>
            </RadixToast.Description>
          )}

          <div className="mt-2 flex justify-end gap-1">
            {t.action && (
              <RadixToast.Action
                altText={t.action.altText ?? t.action.label}
                asChild
              >
                <button
                  onClick={t.action.onClick}
                  className={cn(TOAST_BUTTON_CLASS, "font-semibold underline underline-offset-2")}
                >
                  {t.action.label}
                </button>
              </RadixToast.Action>
            )}
            <RadixToast.Close asChild>
              <button className={TOAST_BUTTON_CLASS}>
                Close
              </button>
            </RadixToast.Close>
          </div>
        </RadixToast.Root>
      ))}
    </>
  );

  return { show, remove, push, ToastElements };
};

export default ToastProvider;
