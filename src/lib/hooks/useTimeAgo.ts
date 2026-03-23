import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";

export function useTimeAgo(timestamp: string | null | undefined): string | null {
  return useMemo(
    () =>
      timestamp
        ? formatDistanceToNow(new Date(timestamp), { addSuffix: true })
        : null,
    [timestamp],
  );
}
