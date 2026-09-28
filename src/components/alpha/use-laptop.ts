"use client";

import { useSyncExternalStore } from "react";

/** The design's one breakpoint: phone below 760 px, laptop from 760 px. */
export const LAPTOP_QUERY = "(min-width: 760px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(LAPTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a laptop-width window. False on the server (phone first). */
export function useIsLaptop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(LAPTOP_QUERY).matches,
    () => false,
  );
}
