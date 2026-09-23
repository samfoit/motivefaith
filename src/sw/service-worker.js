/// Service Worker for MotiveFaith — app shell, push, caching, offline sync
///
/// SOURCE FILE. The deployed worker is generated into `public/sw.js` by
/// `scripts/post-build.js`, which substitutes the __MOTIVE_*__ tokens below
/// with the real build id and the hashed asset paths from the build manifest.
/// Do not edit `public/sw.js` — it is generated and git-ignored.

// Substituted at build time. The guard below is what runs if someone loads
// this source directly (e.g. in a unit test), never in a deployed worker.
var CACHE_VERSION = "__MOTIVE_BUILD_ID__";
if (CACHE_VERSION.indexOf("__MOTIVE_") === 0) {
  CACHE_VERSION = "dev-" + Date.now();
}
var CACHE_NAME = "motive-v" + CACHE_VERSION;
var MAX_CACHE_ENTRIES = 100;

// The app shell: the persistent chrome plus every render-blocking asset needed
// to paint it. Substituted at build time with the real hashed CSS/JS paths so
// a repeat visit or an installed-PWA launch never waits on the network for
// them. Falls back to the navigable routes alone if substitution didn't run.
var SHELL_ROUTES = ["/", "/offline", "/manifest.webmanifest", "/icon-192.png"];
var CRITICAL_ASSETS = [];
var INJECTED_ASSETS = "__MOTIVE_CRITICAL_ASSETS__";
if (INJECTED_ASSETS.indexOf("__MOTIVE_") !== 0) {
  try {
    CRITICAL_ASSETS = JSON.parse(INJECTED_ASSETS);
  } catch (e) {
    CRITICAL_ASSETS = [];
  }
}
var APP_SHELL = SHELL_ROUTES.concat(CRITICAL_ASSETS);

/**
 * Authenticated documents that are safe to cache, because their HTML
 * contains no user data at all.
 *
 * `/main/dashboard` renders only chrome plus an empty client component; its
 * habits, streaks and greeting arrive separately from `/api/dashboard` and
 * live in IndexedDB. So the document is byte-identical for every user, which
 * makes it safe to store and replay — and that is what lets the dashboard
 * paint offline instead of falling back to the dead-end offline page
 * (DIAGNOSIS.md R1).
 *
 * `/main/habits/new` is the same shape: the wizard reads the user id from the
 * local session rather than taking it from the markup, so the form can be
 * opened offline and the habit queued.
 *
 * This is an allowlist, not a prefix test, and it must stay one. Every other
 * /main/* route still renders the user's own data server-side, and caching
 * one of those would leave it in Cache Storage to be read after logout or by
 * the next person on a shared device. Add a route here only once its
 * document carries no user data.
 */
var SHELL_DOCUMENTS = ["/main/dashboard", "/main/habits/new"];
function isShellDocument(pathname) {
  return SHELL_DOCUMENTS.indexOf(pathname) !== -1;
}

/** Only cache same-origin responses with safe content types. */
function isCacheableResponse(response) {
  if (!response.ok) return false;
  if (response.type !== "basic") return false; // only same-origin
  var ct = (response.headers.get("content-type") || "").toLowerCase();
  return (
    ct.startsWith("text/") ||
    ct.startsWith("application/javascript") ||
    ct.startsWith("application/json") ||
    ct.startsWith("image/") ||
    ct.startsWith("font/") ||
    ct.startsWith("application/font") ||
    ct.startsWith("application/octet-stream")
  );
}


/**
 * Trim the cache to MAX_CACHE_ENTRIES, evicting oldest-first but never
 * touching the precached app shell — evicting the shell would silently
 * reintroduce the blank-first-paint this worker exists to prevent.
 */
function trimCache(cacheName, maxEntries) {
  var shell = {};
  for (var i = 0; i < APP_SHELL.length; i++) {
    shell[new URL(APP_SHELL[i], self.location.origin).pathname] = true;
  }
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      var evictable = keys.filter(function (key) {
        return !shell[new URL(key.url).pathname];
      });
      if (evictable.length <= maxEntries) return;
      var toDelete = evictable.slice(0, evictable.length - maxEntries);
      return Promise.all(
        toDelete.map(function (key) { return cache.delete(key); }),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Install — precache app shell
// ---------------------------------------------------------------------------

/**
 * Precache the authenticated shell documents.
 *
 * Deliberately not part of APP_SHELL, because `cache.add()` follows redirects
 * and stores the final response under the *requested* URL. A worker installed
 * while signed out would follow proxy.ts's redirect to /auth/login and store
 * the login page as /main/dashboard — which the next signed-in visitor would
 * then be served offline. So fetch it, judge the response, and only keep it if
 * it really is the shell.
 *
 * Without this, the shell is only cached on the *second* navigation: the first
 * page load is what installs the worker, so no worker was controlling it and
 * nothing saw the response. A user who opened the app once and then lost
 * connectivity would still have got the offline page.
 */
function precacheShellDocuments(cache) {
  return Promise.all(
    SHELL_DOCUMENTS.map(function (path) {
      return fetch(new Request(path, { cache: "reload", credentials: "same-origin" }))
        .then(function (response) {
          if (response.redirected) return; // signed out — not the shell
          if (!isCacheableResponse(response)) return;
          return cache.put(path, response);
        })
        .catch(function () {
          /* offline or blocked at install — the runtime handler will cache it */
        });
    }),
  );
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Content-hashed assets are immutable, so a plain cache-fill is safe.
      // Each asset is added independently: a single 404 (e.g. an asset list
      // that went stale between build and deploy) must not fail the whole
      // install and leave the user with no precached shell at all.
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {
            /* non-fatal — the runtime handlers will fetch it on demand */
          });
        }),
      ).then(function () {
        return precacheShellDocuments(cache);
      });
    }),
  );
  // Do NOT call self.skipWaiting() here — activation is deferred to the
  // SKIP_WAITING message so the user controls when the new SW takes over.
});

// ---------------------------------------------------------------------------
// Activate — clean old caches, claim clients
// ---------------------------------------------------------------------------

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name !== CACHE_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        trimCache(CACHE_NAME, MAX_CACHE_ENTRIES);
        // Enable navigation preload if supported — the browser starts the
        // network fetch in parallel with SW boot, saving ~50-100ms per
        // navigation.
        if (self.registration.navigationPreload) {
          return self.registration.navigationPreload.enable().then(function () {
            return self.clients.claim();
          });
        }
        return self.clients.claim();
      }),
  );
});

// ---------------------------------------------------------------------------
// Fetch — cache strategies
// ---------------------------------------------------------------------------

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip Supabase API calls (auth, realtime, etc.)
  if (url.hostname !== self.location.hostname) return;

  /** Pages behind the sign-in gate. */
  function isAuthenticatedPath(pathname) {
    return pathname.indexOf("/main/") === 0;
  }

  /**
   * Whether a navigation response may be written to the cache.
   *
   * The request path is not enough to answer this. `proxy.ts` redirects a
   * signed-in user from /auth/login and /auth/signup to /main/dashboard, and
   * fetch() follows that redirect transparently — so a "public" request can
   * resolve to authenticated dashboard HTML, which would then be stored under
   * /auth/login and served to whoever opens the login page next: the same user
   * after logout, or anyone else on a shared device. Judge the response:
   *
   *  - `redirected` catches the hop itself. It is also disqualifying on its
   *    own, because a response with the redirected flag set cannot legally be
   *    returned from respondWith() for a navigation request — caching one
   *    would break the page it was cached for.
   *  - the *final* url is re-checked against the authenticated prefix, to
   *    cover a same-path rewrite ever landing on one.
   */
  function isCacheableNavigation(response) {
    if (!isCacheableResponse(response)) return false;
    if (response.redirected) return false;
    if (!response.url) return true; // no url to judge; the hop check stands
    try {
      return !isAuthenticatedPath(new URL(response.url).pathname);
    } catch (e) {
      return false;
    }
  }

  if (event.request.mode === "navigate") {
    // Authenticated pages are network-first, always: the network copy wins
    // whenever there is one, so being online behaves exactly as it did before
    // any of this was cached.
    //
    // What changed is the failure path. A page on the shell allowlist is
    // written to the cache and served back when the network is gone, so the
    // dashboard survives offline. Everything else under /main/ still embeds
    // the user's data in its HTML, is still never written, and still falls
    // back to the offline page.
    //
    // Public pages use stale-while-revalidate: a repeat visit paints from
    // cache with no network in the critical path, and the fresh copy replaces
    // it in the background for next time.
    var isAuthenticatedPage = isAuthenticatedPath(url.pathname);
    var mayCacheDocument = !isAuthenticatedPage || isShellDocument(url.pathname);

    var fromNetwork = (event.preloadResponse || Promise.resolve())
      .then(function (preloaded) {
        return preloaded || fetch(event.request);
      })
      .then(function (response) {
        if (mayCacheDocument && isCacheableNavigation(response)) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });

    if (isAuthenticatedPage) {
      event.respondWith(
        fromNetwork.catch(function () {
          // Offline. Serve the cached shell for this exact URL if there is
          // one — the client then renders it from the persisted query cache.
          // A redirected entry is refused for a navigation request, so an
          // entry left by an older worker must not be served.
          return caches.match(event.request).then(function (cached) {
            if (cached && !cached.redirected) return cached;
            // No shell for this route: a dedicated offline page rather than
            // the public landing page, which would confuse a signed-in user.
            return caches.match("/offline").then(function (offlinePage) {
              return offlinePage || new Response("Offline", { status: 503 });
            });
          });
        }),
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then(function (cached) {
        // A redirected response is refused for a navigation request, so an
        // entry left by an earlier worker would 500 the page rather than
        // serve it. isCacheableNavigation() stops new ones being written;
        // this stops an old one being served.
        if (cached && !cached.redirected) {
          // Revalidate in the background; don't make the user wait for it.
          event.waitUntil(fromNetwork.catch(function () {}));
          return cached;
        }
        return fromNetwork.catch(function () {
          return caches.match("/").then(function (home) {
            return home || new Response("Offline", { status: 503 });
          });
        });
      }),
    );
    return;
  }

  // Cache-first for content-hashed and immutable static assets only.
  // /_next/static/ paths contain content hashes so they are safe to
  // cache permanently. /icon-* are versioned via the manifest.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-")
  ) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (response) {
          if (isCacheableResponse(response)) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      }),
    );
    return;
  }

  // Network-first for everything else (API-like routes on same origin).
  //
  // The same privacy rule as navigations applies here, and for the same
  // reason: a client-side navigation to /main/* fetches the route's RSC
  // payload with mode "cors", not "navigate", so it lands in this branch.
  // Without this check the navigate handler's refusal to cache authenticated
  // HTML was being undone one branch further down — the user's own feed,
  // profile and dashboard payloads were sitting in Cache Storage after
  // logout. Verified present in the cache before this guard was added.
  //
  // `/api/*` is added for the same reason: `/api/dashboard` returns the user's
  // habits as JSON, and `isCacheableResponse` accepts application/json, so it
  // would otherwise be written to the cache and served to whoever asked next.
  var isAuthenticatedPayload =
    url.pathname.startsWith("/main/") || url.pathname.startsWith("/api/");

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (!isAuthenticatedPayload && isCacheableResponse(response)) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      }),
  );
});

// ---------------------------------------------------------------------------
// Push — show notification
// ---------------------------------------------------------------------------

/** Truncate notification text to a safe length. */
function truncateText(text, maxLen) {
  if (typeof text !== "string") return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

self.addEventListener("push", function (event) {
  if (!event.data) return;

  var data;
  try {
    data = event.data.json();
  } catch {
    return; // ignore malformed payloads
  }

  var options = {
    body: truncateText(data.body, 200),
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/badge-96.png",
    tag: data.type || "default",
    data: { url: data.url || "/main/dashboard" },
  };

  event.waitUntil(
    self.registration.showNotification(truncateText(data.title, 100), options),
  );
});

// ---------------------------------------------------------------------------
// Notification click — open or focus the relevant page
// ---------------------------------------------------------------------------

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  // Whitelist allowed navigation targets to prevent push payload injection.
  // Use URL constructor to normalize the path and resolve any traversal segments.
  var ALLOWED_PREFIXES = ["/main/", "/auth/"];
  var rawUrl =
    (event.notification.data && event.notification.data.url) ||
    "/main/dashboard";
  var url = "/main/dashboard";
  if (typeof rawUrl === "string" && rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
    try {
      // Resolve against a dummy base so "../" segments are collapsed
      var normalized = new URL(rawUrl, self.location.origin).pathname;
      if (ALLOWED_PREFIXES.some(function (p) { return normalized.startsWith(p); })) {
        url = normalized;
      }
    } catch {
      // malformed URL — keep default
    }
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if ("focus" in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

// ---------------------------------------------------------------------------
// Background Sync — flush queued completions when back online
// ---------------------------------------------------------------------------

/**
 * Whether an open page is in a position to drain the queue itself.
 *
 * Background Sync exists for the case the page cannot cover: the app is
 * closed. When a window IS open, `useOutboxDrain` there drains on the same
 * connectivity events — so both fire at once and race for the same rows.
 * The claim in `claimQueuedCompletions` keeps that race *safe*, but it still
 * wastes a round trip and, if this worker loses, delays the sync until the
 * next trigger. Deferring to the page is the simpler contract, and the page
 * is the better drainer: it can report progress and refresh what is on screen.
 */
function aWindowIsOpen() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: false })
    .then(function (clients) {
      return clients.length > 0;
    })
    .catch(function () {
      return false; // can't tell — drain rather than risk not syncing at all
    });
}

self.addEventListener("sync", function (event) {
  if (event.tag === "sync-completions") {
    event.waitUntil(
      aWindowIsOpen().then(function (open) {
        if (open) return; // the page has it
        return syncQueuedCompletions();
      }),
    );
  }
});

function openOfflineDB() {
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open("motive-offline", 1);

    request.onupgradeneeded = function (event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains("pending-completions")) {
        db.createObjectStore("pending-completions", { keyPath: "id" });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function () {
      reject(request.error);
    };
  });
}

/**
 * How long a claim is honoured. Must match CLAIM_TIMEOUT_MS in
 * src/lib/offline-queue.ts.
 */
var CLAIM_TIMEOUT_MS = 30 * 1000;

/**
 * Take ownership of the unclaimed rows, in a single readwrite transaction.
 *
 * The page drains this queue too (src/lib/outbox-drain.ts). Without a claim,
 * both contexts read the same rows on the same connectivity event and POST
 * them twice — observed as two identical completions 80ms apart, which
 * inflates the user's streak. IndexedDB transactions are atomic across
 * contexts, so exactly one drainer wins a given row.
 */
function claimQueuedCompletions(db) {
  return new Promise(function (resolve, reject) {
    var tx = db.transaction("pending-completions", "readwrite");
    var store = tx.objectStore("pending-completions");
    var getAll = store.getAll();
    var claimed = [];

    getAll.onsuccess = function () {
      var now = Date.now();
      var rows = getAll.result || [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var heldSince = row.claimedAt ? Date.parse(row.claimedAt) : 0;
        if (heldSince && now - heldSince < CLAIM_TIMEOUT_MS) continue;
        row.claimedAt = new Date(now).toISOString();
        store.put(row);
        claimed.push(row);
      }
    };

    tx.oncomplete = function () {
      claimed.sort(function (a, b) {
        return String(a.queuedAt).localeCompare(String(b.queuedAt));
      });
      resolve(claimed);
    };
    tx.onerror = function () { reject(tx.error); };
    tx.onabort = function () { reject(tx.error); };
  });
}

/** Hand rows back after a transient failure so a later drain retries them. */
function releaseQueuedCompletions(db, ids) {
  if (!ids.length) return Promise.resolve();
  return new Promise(function (resolve) {
    var tx = db.transaction("pending-completions", "readwrite");
    var store = tx.objectStore("pending-completions");
    ids.forEach(function (id) {
      var get = store.get(id);
      get.onsuccess = function () {
        var row = get.result;
        if (!row) return;
        delete row.claimedAt;
        store.put(row);
      };
    });
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { resolve(); };
  });
}

function syncQueuedCompletions() {
  return openOfflineDB().then(function (db) {
    return claimQueuedCompletions(db).then(function (queue) {
      if (queue.length === 0) return;

      var claimedIds = queue.map(function (q) { return q.id; });

      // Sanitise items before sending — strip evidence URLs that should
      // not have been persisted in the offline queue (defense-in-depth).
      var sanitised = queue.map(function (item) {
        return {
          id: item.id,
          habitId: item.habitId,
          type: item.type,
          notes: item.notes || undefined,
          rainCheckReason: item.rainCheckReason || undefined,
          rainCheckMovedTo: item.rainCheckMovedTo || undefined,
          // evidenceUrl is intentionally omitted — files uploaded separately
        };
      });

      return fetch("/api/completions", {
        method: "POST",
        body: JSON.stringify(sanitised),
        headers: {
          "Content-Type": "application/json",
          "Origin": self.location.origin,
        },
      })
        .then(function (response) {
          return response.json().then(
            function (body) { return { ok: response.ok, body: body }; },
            function () { return { ok: response.ok, body: null }; },
          );
        })
        .then(function (result) {
          var successIds;
          if (result.ok) {
            successIds = claimedIds;
          } else if (result.body && Array.isArray(result.body.succeeded)) {
            // Partial success — only remove the ones that went through.
            successIds = result.body.succeeded;
          } else {
            // Total failure (401 auth expired, 5xx, etc.) — release the claim
            // and reject, so Background Sync retries on the next connectivity
            // event instead of silently losing queued completions.
            return releaseQueuedCompletions(db, claimedIds).then(function () {
              throw new Error(
                "Sync failed: " + ((result.body && result.body.error) || "unknown"),
              );
            });
          }

          return deleteQueuedCompletions(db, successIds).then(function () {
            // Anything claimed but not accepted goes back on the queue.
            var accepted = {};
            successIds.forEach(function (id) { accepted[id] = true; });
            return releaseQueuedCompletions(
              db,
              claimedIds.filter(function (id) { return !accepted[id]; }),
            );
          });
        })
        .catch(function (err) {
          // Network failure. Release so a later drain retries, then rethrow so
          // Background Sync knows to schedule one.
          return releaseQueuedCompletions(db, claimedIds).then(function () {
            throw err;
          });
        });
    });
  });
}

/**
 * Delete rows by id.
 *
 * Deliberately not `store.clear()`, even when every claimed row succeeded:
 * the page can queue a new completion while this drain is in flight, and
 * another drainer can hold rows of its own. Clearing would throw those away.
 */
function deleteQueuedCompletions(db, ids) {
  if (!ids.length) return Promise.resolve();
  return new Promise(function (resolve) {
    var tx = db.transaction("pending-completions", "readwrite");
    var store = tx.objectStore("pending-completions");
    ids.forEach(function (id) { store.delete(id); });
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { resolve(); };
  });
}

// ---------------------------------------------------------------------------
// Message — handle postMessage from app windows
// ---------------------------------------------------------------------------

self.addEventListener("message", function (event) {
  // Only accept messages from our own origin
  if (!event.source || !event.source.url) return;
  try {
    var sourceOrigin = new URL(event.source.url).origin;
    if (sourceOrigin !== self.location.origin) return;
  } catch {
    return;
  }

  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
