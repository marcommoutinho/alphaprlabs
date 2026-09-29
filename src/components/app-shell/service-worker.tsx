"use client";

import { useEffect } from "react";

/**
 * Registers the app's service worker (public/sw.js) for everyone signed in,
 * whether or not reminders are on: it also serves the offline page when
 * opening the app finds no connection. It never asks for notifications
 * (that stays with "Turn on reminders"), and the same registration serves
 * push (src/components/push/use-reminders.ts registers it again, harmlessly).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}
