import { cn } from "@/lib/utils/cn";

/**
 * A problem with the whole form rather than one field (offline, the
 * security check, too many attempts), shown just above the submit button so
 * it sits where the person is looking and stays until the next try. Missed
 * Red Ink on its 10% wash, which the palette holds at 4.5:1 at every hour.
 */
export function FormAlert({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-md border border-miss/30 bg-miss/10 px-3 py-2 text-sm text-miss-ink text-center",
        className,
      )}
    >
      {children}
    </p>
  );
}
