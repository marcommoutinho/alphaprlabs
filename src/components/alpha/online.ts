"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the app can reach the server now, for the offline bar and the save
 * controls (useOnline). The app is online-only: offline, nothing is stored or
 * queued; saves wait for the connection.
 *
 * Offline is either the browser saying so (navigator.onLine false, the
 * `offline` event) or a request that failed with a network error while the
 * browser still says online (a dead Wi-Fi, a dropped connection): every
 * fetch in the page is observed, never changed. Online again on the `online`
 * event or the next request that gets any answer; while a failed request is
 * the only sign, a small HEAD request checks every few seconds.
 */
let networkDown = false;
let installed = false;
let probe: ReturnType<typeof setTimeout> | null = null;
let followUp: (() => void) | null = null;
const listeners = new Set<() => void>();

const PROBE_MS = [1_000, 3_000] as const;

const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
const snapshot = () => browserOnline() && !networkDown;
const notify = () => {
  for (const listener of listeners) listener();
};

function setNetworkDown(down: boolean) {
  if (networkDown === down) return;
  networkDown = down;
  if (down) scheduleProbe(0);
  else if (probe) {
    clearTimeout(probe);
    probe = null;
  }
  notify();
  if (snapshot()) cameOnline();
}

/** While only a failed request says offline, check now and then (any answer is online). */
function scheduleProbe(attempt: number) {
  if (probe) clearTimeout(probe);
  probe = setTimeout(
    () => {
      probe = null;
      if (!networkDown) return;
      if (!browserOnline()) return scheduleProbe(attempt + 1);
      fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store" })
        .then(() => setNetworkDown(false))
        .catch(() => scheduleProbe(attempt + 1));
    },
    PROBE_MS[Math.min(attempt, PROBE_MS.length - 1)],
  );
}

const isAbort = (error: unknown) => error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");

function cameOnline() {
  const run = followUp;
  followUp = null;
  run?.();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("online", () => {
    networkDown = false;
    notify();
    cameOnline();
  });
  window.addEventListener("offline", notify);
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    try {
      const response = await original(...args);
      setNetworkDown(false);
      return response;
    } catch (error) {
      if (!isAbort(error)) setNetworkDown(true);
      throw error;
    }
  };
}

function subscribe(listener: () => void) {
  install();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the app can reach the server (see above); true on the server and before hydration. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

/** Runs `run` once the app is online again (a later call replaces it): a navigation tapped while offline. */
export function whenOnline(run: () => void) {
  install();
  followUp = run;
}

/** Whether the app can reach the server now, outside React. */
export const isOnline = (): boolean => snapshot();

/** The reason shown by a save control that waits for the connection. */
export const OFFLINE_REASON = "Offline. This needs a connection.";
