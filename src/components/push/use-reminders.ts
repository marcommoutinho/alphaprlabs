"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { saveDevice, turnOffDevice } from "@/app/(private)/app/notifications/actions";
import { signOut } from "@/app/(private)/auth/actions";
import { signOutDevice } from "@/lib/push/sign-out";
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
// signOutThisDevice, which it calls for researchers only).

const SW_URL = "/sw.js";
// Local, per-device memory (never sent anywhere):
// {userId, endpoint}: the account that turned reminders on here, and this
// device's endpoint (the sign-out fallback when the browser can't report it).
const DEVICE_KEY = "apl.reminders.device";
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

type RememberedDevice = { userId: string; endpoint: string };
const rememberedDevice = {
  get(): RememberedDevice | null {
    try {
      const value = JSON.parse(localFlag.get(DEVICE_KEY) ?? "null") as Partial<RememberedDevice> | null;
      return typeof value?.userId === "string" && typeof value.endpoint === "string"
        ? { userId: value.userId, endpoint: value.endpoint }
        : null;
    } catch {
      return null;
    }
  },
  set: (value: RememberedDevice | null) => localFlag.set(DEVICE_KEY, value ? JSON.stringify(value) : null),
};

/**
 * Runs `listener` whenever the app comes back to the foreground: a phone app
 * reopened from the background is shown again, not reloaded (visibilitychange),
 * and a page restored from the back/forward cache fires pageshow.
 */
export function onForeground(listener: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") listener();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) listener();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onPageShow);
  };
}

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

let inFlight: { userId: string; result: Promise<DeviceState> } | null = null;

/**
 * On every app open and every return to the foreground: when this account
 * turned reminders on here and the permission is still granted, make sure the
 * subscription exists (iOS can drop it) and upsert it, which also refreshes
 * last_seen. Silent; only repeated failures surface (the settings failure
 * state). Concurrent calls share one run; a finished result is never reused.
 */
export function syncThisDevice(userId: string, vapidPublicKey: string): Promise<DeviceState> {
  if (inFlight?.userId === userId) return inFlight.result;
  const result = runSync(userId, vapidPublicKey).finally(() => {
    if (inFlight?.result === result) inFlight = null;
  });
  inFlight = { userId, result };
  return result;
}

async function runSync(userId: string, vapidPublicKey: string): Promise<DeviceState> {
  const facts = readFacts();
  const failures = Number(localFlag.get(FAILURES_KEY) ?? 0);
  if (!canUsePush(facts)) return { facts, subscribed: false, failed: false };
  if (facts.permission !== "granted" || rememberedDevice.get()?.userId !== userId) {
    // Keep the worker installed for notification clicks and badges.
    await registerWorker().catch(() => undefined);
    return { facts, subscribed: false, failed: false };
  }
  try {
    const subscription = await ensureSubscription(vapidPublicKey);
    if (await upload(subscription)) {
      rememberedDevice.set({ userId, endpoint: subscription.endpoint });
      localFlag.set(FAILURES_KEY, null);
      return { facts, subscribed: true, failed: false };
    }
  } catch {
    // fall through
  }
  localFlag.set(FAILURES_KEY, String(failures + 1));
  return { facts, subscribed: false, failed: failures + 1 >= FAILURES_BEFORE_NOTICE };
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Researcher sign-out from the account menu. This device's row is disabled
 * first (endpoint from the live subscription, else the one remembered when
 * reminders were turned on); if the server can't, the browser subscription is
 * dropped instead; if neither works the session is kept and "failed" returned.
 */
export async function signOutThisDevice(): Promise<"signed-out" | "failed"> {
  const remembered = rememberedDevice.get();
  const live = await currentSubscription().catch(() => null);
  // Forget the device first so a later sign-in never re-enables it silently.
  rememberedDevice.set(null);
  let outcome: "signed-out" | "failed";
  try {
    outcome = await signOutDevice({
      endpoint: live?.endpoint ?? remembered?.endpoint ?? null,
      signOut,
      unsubscribe: async () => {
        const subscription = await currentSubscription();
        return subscription ? subscription.unsubscribe() : true;
      },
    });
  } catch {
    outcome = "failed";
  }
  if (outcome === "failed") rememberedDevice.set(remembered);
  return outcome;
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
  // Bumped by turn on/off, so a background re-check that started earlier
  // can't overwrite their result.
  const generation = useRef(0);

  useEffect(() => {
    let live = true;
    const check = () => {
      const started = generation.current;
      syncThisDevice(userId, vapidPublicKey).then((state) => {
        if (live && generation.current === started) setDevice(state);
      });
    };
    captureInstallPrompt();
    check();
    const stop = onForeground(check);
    return () => {
      live = false;
      stop();
    };
  }, [userId, vapidPublicKey]);

  const show = useCallback((state: DeviceState) => {
    generation.current += 1;
    setDevice(state);
  }, []);

  const turnOn = useCallback<Reminders["turnOn"]>(async () => {
    setBusy("on");
    generation.current += 1;
    try {
      let permission = readFacts().permission;
      if (permission !== "granted") permission = (await Notification.requestPermission()) as Permission;
      if (permission !== "granted") {
        show({ facts: readFacts(), subscribed: false, failed: false });
        return permission === "denied" ? "denied" : "dismissed";
      }
      let endpoint: string | null = null;
      try {
        const subscription = await ensureSubscription(vapidPublicKey);
        if (await upload(subscription)) endpoint = subscription.endpoint;
      } catch {
        endpoint = null;
      }
      rememberedDevice.set(endpoint ? { userId, endpoint } : null);
      localFlag.set(FAILURES_KEY, null);
      show({ facts: readFacts(), subscribed: endpoint !== null, failed: endpoint === null });
      return endpoint ? "enabled" : "failed";
    } finally {
      setBusy(null);
    }
  }, [show, userId, vapidPublicKey]);

  const turnOff = useCallback<Reminders["turnOff"]>(async () => {
    setBusy("off");
    generation.current += 1;
    try {
      const subscription = await currentSubscription();
      const endpoint = subscription?.endpoint ?? rememberedDevice.get()?.endpoint;
      if (endpoint) {
        // Server first: if that fails, the device stays registered and says so.
        const result = await turnOffDevice({ endpoint });
        if (!result.ok) return false;
        await subscription?.unsubscribe().catch(() => undefined);
      }
      rememberedDevice.set(null);
      localFlag.set(FAILURES_KEY, null);
      show({ facts: readFacts(), subscribed: false, failed: false });
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  }, [show]);

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
