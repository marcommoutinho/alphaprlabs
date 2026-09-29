"use client";

import { useMemo, useSyncExternalStore } from "react";
import { detectInstall, type InstallDevice } from "@/lib/install/detect";
import { readFacts, useInstallPrompt } from "./use-reminders";

const noop = () => () => {};

/** The facts the guide needs, as one string (a stable snapshot for useSyncExternalStore). */
function factsKey(): string {
  const { userAgent, maxTouchPoints, standalone } = readFacts();
  return JSON.stringify([userAgent, maxTouchPoints, standalone]);
}

function useDetected(canPrompt: boolean): InstallDevice | null {
  const key = useSyncExternalStore(noop, factsKey, () => null);
  return useMemo(() => {
    if (key === null) return null;
    const [userAgent, maxTouchPoints, standalone] = JSON.parse(key) as [string, number, boolean];
    return detectInstall({ userAgent, maxTouchPoints, standalone, canPrompt });
  }, [key, canPrompt]);
}

/**
 * This phone and browser, for the Me row and the account menu item. Decided
 * in the browser (the server can't tell the installed app from a tab): null
 * while rendering on the server and during hydration, so nothing that
 * depends on it ever flashes on the installed app.
 */
export function useThisDevice(): InstallDevice | null {
  return useDetected(false);
}

/**
 * The same for the install guide, with the browser's install prompt
 * (Android / Chromium): `device.canPrompt` once the browser offered it,
 * `acceptedHere` once it was accepted in this tab.
 */
export function useInstallDevice(): { device: InstallDevice | null; acceptedHere: boolean; install: () => Promise<void> } {
  const prompt = useInstallPrompt();
  const device = useDetected(prompt.canInstall);
  return { device, acceptedHere: prompt.installed, install: prompt.install };
}
