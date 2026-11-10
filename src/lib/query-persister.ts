/**
 * IndexedDB-based persister for React Query.
 * Persists the query cache across app restarts so users can view
 * their habits and data when offline or on cold start.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { get, set, del } from "idb-keyval";

const IDB_KEY = "motive-query-cache";

export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(IDB_KEY, client);
    },
    restoreClient: async () => {
      return await get<PersistedClient>(IDB_KEY);
    },
    removeClient: async () => {
      await del(IDB_KEY);
    },
  };
}

/**
 * Mark everything just restored as out of date, so each query on screen asks
 * the server once as it mounts. The restored data still shows straight away,
 * and offline it is all there is.
 *
 * A restored query keeps the time it was last fetched, and its staleTime then
 * decides whether it is fetched again. Reopened within a minute of the last
 * fetch (the dashboard's staleTime), the app showed its saved habits without
 * asking: one made on another device in the meantime didn't appear, and
 * reopening again didn't help.
 *
 * For PersistQueryClientProvider's `onSuccess`, which runs before anything
 * subscribes: marking is enough, and the mounts do the fetching.
 */
export function markRestoredStale(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ refetchType: "none" });
}
