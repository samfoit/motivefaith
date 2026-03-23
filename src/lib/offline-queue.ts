/**
 * IndexedDB-backed offline queue for habit completions.
 * When the user is offline, completions are stored here and
 * synced via the service worker's Background Sync API.
 */

const DB_NAME = "motive-offline";
const DB_VERSION = 1;
const STORE_NAME = "pending-completions";

import type { CompletionType } from "@/lib/constants/completion";

export interface QueuedCompletion {
  id: string;
  habitId: string;
  type: CompletionType;
  evidenceUrl?: string;
  notes?: string;
  queuedAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Queue a completion for later sync.
 * Also registers a Background Sync so the SW will flush the queue
 * once connectivity returns.
 */
export async function queueCompletion(
  completion: Omit<QueuedCompletion, "id" | "queuedAt">,
): Promise<void> {
  const item: QueuedCompletion = {
    ...completion,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
  };

  const db = await openDB();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Register Background Sync if available
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    const registration = await navigator.serviceWorker.ready;
    await (
      registration as ServiceWorkerRegistration & {
        sync: { register: (tag: string) => Promise<void> };
      }
    ).sync.register("sync-completions");
  }
}

/**
 * Get the count of queued (pending) completions.
 */
export async function getPendingCount(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to read offline queue:", err);
    return 0;
  }
}
