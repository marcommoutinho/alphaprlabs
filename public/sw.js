// Alpha PR Labs service worker (research app, scope "/"). Registered only by
// the researcher area on the app host.
//
// It shows push notifications, opens the app when one is tapped and sets the
// app icon badge. It deliberately has NO fetch handler and uses no caches:
// every page and all private data always come from the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const APP_HOME = "/app";

/**
 * The absolute URL to open for a notification: a relative path inside the
 * researcher app (/app or below) on this origin; anything else, including
 * other same-origin paths (which redirect to the public site), opens /app.
 * Same rule as appNotificationPath() in src/lib/push/send.ts.
 */
function appUrl(path) {
  const home = new URL(APP_HOME, self.location.origin).href;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return home;
  if (/[\\\s\x00-\x1f\x7f]/.test(path)) return home;
  try {
    const url = new URL(path, self.location.origin);
    // Resolved, so "/app/../about" and "/app/%2e%2e/about" are caught here.
    if (url.origin === self.location.origin && (url.pathname === APP_HOME || url.pathname.startsWith(`${APP_HOME}/`))) {
      return url.href;
    }
  } catch {
    // fall through
  }
  return home;
}

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
    data: { url: appUrl(data.url) },
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
