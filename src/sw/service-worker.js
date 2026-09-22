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
      );
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

  /** Pages whose HTML embeds the signed-in user's own data. */
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

  if (event.request.mode === "navigate") {
    // Authenticated pages are never written to the cache: their HTML embeds
    // the user's own data, which must not survive logout or leak on a shared
    // device. They stay network-first, falling back to the offline page.
    //
    // Public pages use stale-while-revalidate: a repeat visit paints from
    // cache with no network in the critical path, and the fresh copy replaces
    // it in the background for next time.
    var isAuthenticatedPage = isAuthenticatedPath(url.pathname);

    var fromNetwork = (event.preloadResponse || Promise.resolve())
      .then(function (preloaded) {
        return preloaded || fetch(event.request);
      })
      .then(function (response) {
        if (!isAuthenticatedPage && isCacheableNavigation(response)) {
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
          // A dedicated offline page rather than the public landing page,
          // which would be confusing for a signed-in user.
          return caches.match("/offline").then(function (offlinePage) {
            return offlinePage || new Response("Offline", { status: 503 });
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
  var isAuthenticatedPayload = url.pathname.startsWith("/main/");

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

self.addEventListener("sync", function (event) {
  if (event.tag === "sync-completions") {
    event.waitUntil(syncQueuedCompletions());
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

function syncQueuedCompletions() {
  return openOfflineDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("pending-completions", "readonly");
      var store = tx.objectStore("pending-completions");
      var getAll = store.getAll();

      getAll.onsuccess = function () {
        var queue = getAll.result || [];
        if (queue.length === 0) {
          resolve();
          return;
        }

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

        // Batch all queued completions into a single API call
        fetch("/api/completions", {
          method: "POST",
          body: JSON.stringify(sanitised),
          headers: {
            "Content-Type": "application/json",
            "Origin": self.location.origin,
          },
        })
          .then(function (response) {
            return response.json().then(function (body) {
              return { ok: response.ok, body: body };
            });
          })
          .then(function (result) {
            // Determine which items succeeded
            var successIds;
            if (result.ok) {
              // All succeeded — clear everything
              successIds = queue.map(function (q) { return q.id; });
            } else if (result.body && Array.isArray(result.body.succeeded)) {
              // Partial success — only remove the ones that went through
              successIds = result.body.succeeded;
            } else {
              // Total failure (401 auth expired, 5xx, etc.) — reject so
              // Background Sync retries on the next connectivity event
              // instead of silently losing queued completions.
              reject(new Error("Sync failed: " + (result.body && result.body.error || "unknown")));
              return;
            }

            if (successIds.length === 0) {
              resolve();
              return;
            }

            var deleteTx = db.transaction("pending-completions", "readwrite");
            var deleteStore = deleteTx.objectStore("pending-completions");

            if (successIds.length === queue.length) {
              deleteStore.clear();
            } else {
              for (var i = 0; i < successIds.length; i++) {
                deleteStore.delete(successIds[i]);
              }
            }

            deleteTx.oncomplete = function () { resolve(); };
            deleteTx.onerror = function () { resolve(); };
          })
          .catch(function () {
            // Will retry on next sync event
            resolve();
          });
      };

      getAll.onerror = function () {
        reject(getAll.error);
      };
    });
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
