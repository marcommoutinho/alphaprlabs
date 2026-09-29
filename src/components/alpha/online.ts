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
export const PROBE_TIMEOUT_MS = 5_000;
/** The page's own fetch, before it is observed: the connection check isn't a request of the app's. */
let baseFetch: typeof fetch | null = null;

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

/**
 * While only a failed request says offline, check now and then (any answer is
 * online). A check that gets no answer within PROBE_TIMEOUT_MS is cancelled
 * and counts as still offline, so a stalled one never leaves the app offline.
 */
function scheduleProbe(attempt: number) {
  if (probe) clearTimeout(probe);
  probe = setTimeout(
    () => {
      probe = null;
      if (!networkDown) return;
      if (!browserOnline()) return scheduleProbe(attempt + 1);
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("The connection check got no answer."));
        }, PROBE_TIMEOUT_MS);
      });
      const check = (baseFetch ?? fetch)("/manifest.webmanifest", { method: "HEAD", cache: "no-store", signal: controller.signal });
      Promise.race([check, timedOut])
        .then(
          () => setNetworkDown(false),
          () => {
            if (networkDown && !probe) scheduleProbe(attempt + 1);
          },
        )
        .finally(() => clearTimeout(timeout));
      check.catch(() => undefined);
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
  baseFetch = original;
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

/**
 * Runs `run` once the app is online again (a later call replaces it): a
 * navigation tapped while offline. Returns a cancel.
 */
export function whenOnline(run: () => void): () => void {
  install();
  followUp = run;
  return () => {
    if (followUp === run) followUp = null;
  };
}

/** Whether the app can reach the server now, outside React. */
export const isOnline = (): boolean => snapshot();

/** The reason shown by a save control that waits for the connection. */
export const OFFLINE_REASON = "Offline. This needs a connection.";
