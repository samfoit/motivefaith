import { ArrowLeft } from "lucide-react";

interface ModeHeaderProps {
  label: string;
  onBack: () => void;
}

export function ModeHeader({ label, onBack }: ModeHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <button
        type="button"
        onClick={onBack}
        className="p-1.5 -ml-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
        aria-label="Go back"
      >
        <ArrowLeft className="w-4 h-4 text-[var(--color-text-secondary)]" />
      </button>
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
        {label}
      </h3>
    </div>
  );
}
