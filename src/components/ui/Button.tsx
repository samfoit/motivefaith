import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center font-medium",
    "transition-transform duration-200 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-0.5 hover:scale-105",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-indigo-600 text-white border-transparent hover:bg-indigo-700 focus-visible:ring-indigo-500",
        secondary:
          "bg-transparent text-indigo-600 border border-indigo-200 hover:bg-indigo-50 focus-visible:ring-indigo-300",
        ghost:
          "bg-transparent text-indigo-600 hover:bg-indigo-50 border-transparent",
      },
      size: {
        sm: "px-3 py-1.5 text-sm rounded-md",
        md: "px-4 py-2 text-sm rounded-md",
        lg: "px-5 py-3 text-base rounded-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const SPINNER_SIZE = {
  sm: "w-4 h-4",
  md: "w-4.5 h-4.5",
  lg: "w-5 h-5",
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          buttonVariants({ variant, size }),
          "gap-2 select-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {loading && (
          <svg
            className={cn("animate-spin text-current", SPINNER_SIZE[size!])}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            ></path>
          </svg>
        )}

        <span className={cn(loading ? "opacity-90" : "")}>{children}</span>
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
