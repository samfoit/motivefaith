/**
 * IndexedDB-based persister for React Query.
 * Persists the query cache across app restarts so users can view
 * their habits and data when offline or on cold start.
 */

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
