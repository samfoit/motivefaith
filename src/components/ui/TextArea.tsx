import React from "react";
import { cn } from "@/lib/utils/cn";

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string | null;
  helper?: string | null;
  error?: string | boolean | null;
  rows?: number;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      label,
      helper = null,
      error = null,
      id,
      className,
      disabled,
      rows = 4,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const textId = id ?? generatedId;
    const helpId =
      helper || (typeof error === "string" ? error : null)
        ? `${textId}-help`
        : undefined;
    const hasError = Boolean(error);

    return (
      <div className={cn("flex flex-col space-y-1")}>
        {label && (
          <label htmlFor={textId} className="text-sm font-medium text-[var(--color-text-primary)]">
            {label}
          </label>
        )}

        <textarea
          id={textId}
          ref={ref}
          rows={rows}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={helpId}
          className={cn(
            "w-full rounded-md border bg-[var(--color-bg-elevated)] px-3 py-2 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] transition-colors focus:outline-none resize-vertical",
            "border-[var(--color-surface-hover)] focus:ring-2 focus:ring-indigo-500 focus:border-indigo-600",
            hasError &&
              "border-rose-400 focus:ring-2 focus:ring-rose-500 focus:border-rose-600",
            disabled && "opacity-60 cursor-not-allowed",
            className,
          )}
          {...props}
        />

        {(helper || typeof error === "string") && (
          <p
            id={helpId}
            className={cn(
              "text-xs mt-0.5",
              typeof error === "string" ? "text-[var(--color-miss)]" : "text-[var(--color-text-secondary)]",
            )}
            aria-live={hasError ? "assertive" : "polite"}
          >
            {typeof error === "string" ? error : helper}
          </p>
        )}
      </div>
    );
  },
);

TextArea.displayName = "TextArea";

export default TextArea;
