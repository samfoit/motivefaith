import { DashboardSkeleton } from "./DashboardSkeleton";

/**
 * Route-level loading state.
 *
 * Now that `page.tsx` is a data-free shell this rarely fires — the document
 * has nothing to await — but it still covers the RSC fetch on a client-side
 * navigation into the route. The data wait itself is rendered by
 * `DashboardClient`, from the same skeleton, so the two cannot disagree.
 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
