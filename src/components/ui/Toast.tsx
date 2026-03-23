import React from "react";
import * as RadixToast from "@radix-ui/react-toast";
import { cn } from "@/lib/utils/cn";

export type ToastVariant = "success" | "error" | "info" | "encourage";

type ToastItem = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "bg-green-50 border-green-200 text-green-900",
  error: "bg-red-50 border-red-200 text-red-900",
  info: "bg-sky-50 border-sky-200 text-sky-900", // brand/info
  encourage: "bg-violet-50 border-violet-200 text-violet-900",
};

export const ToastProvider: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  return (
    <RadixToast.Provider swipeDirection="down">
      {children}
      <RadixToast.Viewport
        className="fixed bottom-6 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 space-y-2 outline-none"
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
          duration={3000}
          onOpenChange={(open) => {
            if (!open) remove(t.id);
          }}
          className={cn(
            "pointer-events-auto w-full rounded-md border p-3 shadow-lg",
            "grid gap-1 auto-rows-max",
            VARIANT_CLASSES[t.variant ?? "info"],
          )}
        >
          {t.title && (
            <RadixToast.Title className="font-medium text-sm">
              {t.title}
            </RadixToast.Title>
          )}
          {t.description && (
            <RadixToast.Description asChild>
              <div className="text-xs">{t.description}</div>
            </RadixToast.Description>
          )}

          <div className="mt-2 flex justify-end">
            <RadixToast.Close asChild>
              <button className="text-xs px-2 py-1 rounded-md hover:bg-white/30">
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
