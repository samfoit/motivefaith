import React from "react";
import { cn } from "@/lib/utils/cn";

interface EmptyStateProps {
  message: string;
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({ message, className, children }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg bg-elevated ring-1 ring-border p-4", className)}>
      <p className="text-sm text-[var(--color-text-secondary)] text-center">
        {message}
      </p>
      {children}
    </div>
  );
}
