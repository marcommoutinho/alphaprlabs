"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { saveDevice, turnOffDevice } from "@/app/(private)/app/notifications/actions";
import {
  base64UrlToBytes,
  deviceLabel,
  isAppleMobile,
  reminderStatus,
  type DeviceFacts,
  type Permission,
  type ReminderStatus,
} from "@/lib/push/readiness";

// Browser side of "Reminders on this phone": the service worker, this
// device's push subscription and what this device remembers locally.
// Used by the researcher area only (the shared account menu imports
// endpointForSignOut, which it calls for researchers only).

const SW_URL = "/sw.js";
// Local, per-device memory (never sent anywhere):
const OWNER_KEY = "apl.reminders.owner"; // account that turned reminders on here
const FAILURES_KEY = "apl.reminders.failures"; // consecutive failed re-registrations
const SEEN_KEY = "apl.reminders.readiness-seen"; // step 3 shown once in the installed app
/** Consecutive silent re-registration failures before settings shows the failure state. */
const FAILURES_BEFORE_NOTICE = 3;

const localFlag = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (private mode): nothing is remembered.
    }
  },
};

export const readinessSeen = {
  get: () => localFlag.get(SEEN_KEY) === "1",
  mark: () => localFlag.set(SEEN_KEY, "1"),
};

// ── Install prompt (Android / Chromium) ────────────────────────────────────
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type InstallState = { prompt: InstallPromptEvent | null; installed: boolean };

let installState: InstallState = { prompt: null, installed: false };
const installListeners = new Set<() => void>();
const setInstallState = (next: Partial<InstallState>) => {
  installState = { ...installState, ...next };
  installListeners.forEach((listener) => listener());
};

let capturing = false;
/**
 * Researcher area only (PushSync and the C2 screens call it on mount): keeps
 * the browser's one-per-page install prompt for the "Install app" button.
 */
export function captureInstallPrompt() {
  if (capturing) return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    setInstallState({ prompt: event as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => setInstallState({ prompt: null, installed: true }));
}

const SERVER_INSTALL_STATE: InstallState = { prompt: null, installed: false };
function useInstallState(): InstallState {
  return useSyncExternalStore(
    (listener) => {
      installListeners.add(listener);
      return () => installListeners.delete(listener);
    },
    () => installState,
    () => SERVER_INSTALL_STATE,
  );
}

// ── Device facts and subscription ──────────────────────────────────────────
function readFacts(): DeviceFacts {
  const pushApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return {
    pushApi,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    permission: "Notification" in window ? (Notification.permission as Permission) : null,
  };
}

const canUsePush = (facts: DeviceFacts) =>
  facts.pushApi && (facts.standalone || !isAppleMobile(facts.userAgent, facts.maxTouchPoints));

function registerWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true; // browsers that don't report it
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

/** This device's subscription for our VAPID key, subscribing again if the browser lost it. */
async function ensureSubscription(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await registerWorker();
  await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(vapidPublicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing, key)) return existing;
  if (existing) await existing.unsubscribe();
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

async function upload(subscription: PushSubscription): Promise<boolean> {
  const json = subscription.toJSON();
  const result = await saveDevice({
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0),
  });
  return result.ok;
}

export type DeviceState = { facts: DeviceFacts; subscribed: boolean; failed: boolean };

let syncing: { userId: string; result: Promise<DeviceState> } | null = null;

/**
 * For sign-out: the endpoint of this device's subscription, if any, so the
 * server can disable it; the next sign-in re-checks the device from scratch.
 */
export async function endpointForSignOut(): Promise<string | null> {
  syncing = null;
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Once per app open: when this account turned reminders on here and the
 * permission is still granted, make sure the subscription exists (iOS can
 * drop it) and upsert it, which also refreshes last_seen. Silent; only
 * repeated failures surface (as the settings failure state).
 */
export function syncThisDevice(userId: string, vapidPublicKey: string): Promise<DeviceState> {
  if (syncing?.userId !== userId) syncing = { userId, result: runSync(userId, vapidPublicKey) };
  return syncing.result;
}

async function runSync(userId: string, vapidPublicKey: string): Promise<DeviceState> {
  const facts = readFacts();
  const failures = Number(localFlag.get(FAILURES_KEY) ?? 0);
  if (!canUsePush(facts)) return { facts, subscribed: false, failed: false };
  if (facts.permission !== "granted" || localFlag.get(OWNER_KEY) !== userId) {
    // Keep the worker installed for notification clicks and badges.
    await registerWorker().catch(() => undefined);
    return { facts, subscribed: false, failed: false };
  }
  try {
    if (await upload(await ensureSubscription(vapidPublicKey))) {
      localFlag.set(FAILURES_KEY, null);
      return { facts, subscribed: true, failed: false };
    }
  } catch {
    // fall through
  }
  localFlag.set(FAILURES_KEY, String(failures + 1));
  return { facts, subscribed: false, failed: failures + 1 >= FAILURES_BEFORE_NOTICE };
}

// ── The hook behind the step-3 and settings screens ────────────────────────
export type Reminders = {
  checking: boolean;
  status: ReminderStatus;
  installed: boolean;
  /** One-tap install is available (Android / Chromium). */
  canInstall: boolean;
  busy: "on" | "off" | null;
  turnOn: () => Promise<"enabled" | "denied" | "dismissed" | "failed">;
  turnOff: () => Promise<boolean>;
  install: () => Promise<void>;
};

export function useReminders(userId: string, vapidPublicKey: string): Reminders {
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [busy, setBusy] = useState<Reminders["busy"]>(null);
  const install = useInstallState();

  useEffect(() => {
    let live = true;
    captureInstallPrompt();
    syncThisDevice(userId, vapidPublicKey).then((state) => live && setDevice(state));
    return () => {
      live = false;
    };
  }, [userId, vapidPublicKey]);

  const remember = useCallback(
    (state: DeviceState) => {
      syncing = { userId, result: Promise.resolve(state) };
      setDevice(state);
    },
    [userId],
  );

  const turnOn = useCallback<Reminders["turnOn"]>(async () => {
    setBusy("on");
    try {
      let permission = readFacts().permission;
      if (permission !== "granted") permission = (await Notification.requestPermission()) as Permission;
      if (permission !== "granted") {
        remember({ facts: readFacts(), subscribed: false, failed: false });
        return permission === "denied" ? "denied" : "dismissed";
      }
      let ok = false;
      try {
        ok = await upload(await ensureSubscription(vapidPublicKey));
      } catch {
        ok = false;
      }
      localFlag.set(OWNER_KEY, ok ? userId : null);
      localFlag.set(FAILURES_KEY, null);
      remember({ facts: readFacts(), subscribed: ok, failed: !ok });
      return ok ? "enabled" : "failed";
    } finally {
      setBusy(null);
    }
  }, [remember, userId, vapidPublicKey]);

  const turnOff = useCallback<Reminders["turnOff"]>(async () => {
    setBusy("off");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Server first: if that fails, the device stays registered and says so.
        const result = await turnOffDevice({ endpoint: subscription.endpoint });
        if (!result.ok) return false;
        await subscription.unsubscribe().catch(() => undefined);
      }
      localFlag.set(OWNER_KEY, null);
      localFlag.set(FAILURES_KEY, null);
      remember({ facts: readFacts(), subscribed: false, failed: false });
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  }, [remember]);

  const promptInstall = useCallback(async () => {
    const prompt = installState.prompt;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    // A prompt can be used only once; accepted also fires "appinstalled".
    setInstallState({ prompt: null, installed: installState.installed || choice.outcome === "accepted" });
  }, []);

  const facts = device?.facts;
  const installed = Boolean(facts?.standalone) || install.installed;
  return {
    checking: device === null,
    status: device ? reminderStatus(device.facts, device) : "not-requested",
    installed,
    canInstall: !installed && install.prompt !== null,
    busy,
    turnOn,
    turnOff,
    install: promptInstall,
  };
}
