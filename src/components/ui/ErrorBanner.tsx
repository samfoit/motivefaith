import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ErrorBannerProps {
  message: string;
  className?: string;
}

export function ErrorBanner({ message, className }: ErrorBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg bg-miss/10 px-3 py-2 text-sm text-miss",
        className,
      )}
    >
      <X className="w-4 h-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}
