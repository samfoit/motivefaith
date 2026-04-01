/// Service Worker for MotiveFaith — push, caching, offline sync

// Auto-generated at build time — no manual bump needed.
// 3b27SkVEhDO29tSKQZzwy is replaced by the build script; falls back to timestamp.
var CACHE_VERSION = "U0tjyUVd2loiNjINbzybo";
if (CACHE_VERSION === "__BUILD_" + "ID__") {
  // Fallback: not replaced by build script — use a timestamp so each
  // new SW file evaluation gets a unique cache name.
  CACHE_VERSION = "dev-" + Date.now();
}
var CACHE_NAME = "motive-v" + CACHE_VERSION;
var MAX_CACHE_ENTRIES = 100;

// App shell files to precache on install.
// __CRITICAL_ASSETS__ is replaced by the post-build script with hashed
// static assets (CSS, main JS entry); falls back to the base set.
var APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png"];
var CRITICAL_ASSETS = "__CRITICAL_ASSETS__";
if (CRITICAL_ASSETS !== "__CRITICAL_" + "ASSETS__") {
  try { APP_SHELL = APP_SHELL.concat(JSON.parse(CRITICAL_ASSETS)); } catch (e) { /* ignore */ }
}

/** Trim cache to MAX_CACHE_ENTRIES (keeps most recent) */
function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then(function (cache) {
    cache.keys().then(function (keys) {
      if (keys.length > maxEntries) {
        cache.delete(keys[0]).then(function () {
          if (keys.length - 1 > maxEntries) {
            trimCache(cacheName, maxEntries);
          }
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Install — precache app shell
// ---------------------------------------------------------------------------

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }),
  );
  self.skipWaiting();
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

  // Network-first for navigation requests (HTML pages)
  if (event.request.mode === "navigate") {
    // Skip caching authenticated pages to prevent stale user data
    // from being served on shared devices or after logout.
    var isAuthenticatedPage = url.pathname.startsWith("/main/");
    event.respondWith(
      // Use navigation preload response if available (started in parallel
      // with SW boot), otherwise fall back to a normal fetch.
      (event.preloadResponse || Promise.resolve()).then(function (preloaded) {
        return preloaded || fetch(event.request);
      })
        .then(function (response) {
          if (!isAuthenticatedPage && isCacheableResponse(response)) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function () {
          if (isAuthenticatedPage) {
            // Don't serve cached authenticated content — fall through to
            // the browser's default offline page or the app shell.
            return caches.match("/").then(function (shell) {
              return shell || new Response("Offline", { status: 503 });
            });
          }
          return caches.match(event.request).then(function (cached) {
            return cached || caches.match("/");
          });
        }),
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|woff2?)$/)
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

  // Network-first for everything else (API-like routes on same origin)
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (isCacheableResponse(response)) {
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
    badge: data.badge || "/icon-192.png",
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
  // Use URL constructor to normalise the path and resolve any traversal segments.
  var ALLOWED_PREFIXES = ["/main/", "/auth/"];
  var rawUrl =
    (event.notification.data && event.notification.data.url) ||
    "/main/dashboard";
  var url = "/main/dashboard";
  if (typeof rawUrl === "string" && rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
    try {
      // Resolve against a dummy base so "../" segments are collapsed
      var normalised = new URL(rawUrl, self.location.origin).pathname;
      if (ALLOWED_PREFIXES.some(function (p) { return normalised.startsWith(p); })) {
        url = normalised;
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
        // not have been persisted in the offline queue (defence-in-depth).
        var sanitised = queue.map(function (item) {
          return {
            id: item.id,
            habitId: item.habitId,
            type: item.type,
            notes: item.notes || undefined,
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
              // Total failure — retry on next sync
              resolve();
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
