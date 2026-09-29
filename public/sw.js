// Alpha PR Labs service worker (research app, scope "/"). Registered by the
// signed-in app (src/components/app-shell/service-worker.tsx) on the app host
// only; the public site's host has its own origin and never gets it.
//
// It shows push notifications, opens the app when one is tapped and sets the
// app icon badge. Offline launch: it precaches ONE static, self-contained
// page (offline.html), and serves that page only when opening an app
// page (a navigation to /app, /admin or /auth) finds no network. It never
// caches or serves any app page, RSC payload, API response or other request:
// every page and all private data always come from the network.
const OFFLINE_CACHE = "alpha-offline-v1";
const OFFLINE_PAGE = "/offline.html";
const APP_PREFIXES = ["/app", "/admin", "/auth"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_PAGE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Older versions of the offline page go; nothing else is ever stored.
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("alpha-offline-") && name !== OFFLINE_CACHE).map((name) => caches.delete(name)));
      // The page request starts while the worker boots, so opening the app is no slower.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined);
      await self.clients.claim();
    })(),
  );
});

const isAppPage = (url) =>
  url.origin === self.location.origin && APP_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));

// Network first, for app page loads only; the offline page when the network fails.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET" || !isAppPage(new URL(request.url))) return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        const offline = await caches.match(OFFLINE_PAGE, { cacheName: OFFLINE_CACHE });
        return offline || Response.error();
      }
    })(),
  );
});

const APP_HOME = "/app";

/**
 * A notification's target as a relative path inside the researcher app
 * (/app or below); anything else, including other same-origin paths (which
 * redirect to the public site), becomes /app. Same rule as
 * appNotificationPath() in src/lib/push/send.ts. The push handler stores this
 * path and the click handler checks it again before opening it.
 */
function appPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return APP_HOME;
  if (/[\\\s\x00-\x1f\x7f]/.test(path)) return APP_HOME;
  try {
    const url = new URL(path, self.location.origin);
    // Resolved, so "/app/../about" and "/app/%2e%2e/about" are caught here.
    if (url.origin === self.location.origin && (url.pathname === APP_HOME || url.pathname.startsWith(`${APP_HOME}/`))) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // fall through
  }
  return APP_HOME;
}

const appUrl = (path) => new URL(appPath(path), self.location.origin).href;

/** App icon badge: a count (iPhone) or dot (some Android launchers); 0 clears it. */
function setBadge(count) {
  const nav = self.navigator;
  try {
    if (count > 0 && typeof nav.setAppBadge === "function") return nav.setAppBadge(count).catch(() => {});
    if (count <= 0 && typeof nav.clearAppBadge === "function") return nav.clearAppBadge().catch(() => {});
  } catch {
    // Badging API not supported here.
  }
  return Promise.resolve();
}

// Payload (src/lib/push/send.ts): { title, body, url, tag, badge? }
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Alpha PR Labs";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : undefined;
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/app-icons/icon-192.png",
    data: { url: appPath(data.url) },
    // A newer notification with the same tag replaces the older one and alerts again.
    ...(tag ? { tag, renotify: true } : {}),
  };
  const work = [self.registration.showNotification(title, options)];
  if (typeof data.badge === "number" && Number.isFinite(data.badge)) work.push(setBadge(data.badge));
  event.waitUntil(Promise.all(work));
});

// Tapping a notification focuses an open app window and shows the target
// page there, or opens the app on it. Only same-origin URLs are opened.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        const focused = await open.focus().catch(() => open);
        if (focused.url === target) return;
        // navigate() needs a window this worker controls; otherwise open one.
        const shown = await focused.navigate(target).catch(() => null);
        if (shown) return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The push service replaced or expired the subscription: subscribe again with
// the same key. The app uploads the new subscription the next time it opens
// (it re-registers on every open); the old endpoint is disabled when the push
// service reports it gone.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => undefined),
  );
});
