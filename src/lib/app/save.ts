// What a server action answers about a save, shared by the actions (server)
// and the screens (client): the handoff's failed-save copy and a toast tone,
// and the screens' bounded wait for the refreshed page after a save.

/** How a screen shows an action's `toast`: "info" as a success toast, "warn" and "error" as an error toast. */
export type ToastTone = "info" | "warn" | "error";

/** Handoff copy for any failed save; the form keeps the person's input. */
export const SAVE_FAILED_MESSAGE = "Could not save. Nothing was lost — your entry is still here. Try again.";

/** How long a screen waits for the refreshed page after a save is answered: once, then again after one more refresh. */
export const REFRESH_WAIT_MS = 8_000;

/** The give-up message's end, after what the answer said ("Saved."); the page on screen is the one from before. */
export const REFRESH_STALLED = "Couldn't load the latest version.";

export type RefreshWaitPhase = "waiting" | "retrying" | "gave-up" | "arrived";

type Timers = { set: (run: () => void, ms: number) => unknown; clear: (timer: unknown) => void };
const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export type RefreshWait = {
  phase: () => RefreshWaitPhase;
  /** The refreshed page is here (or the screen was replaced): stop, quietly. */
  arrived: () => void;
  /** Loading it failed: give up now. */
  failed: () => void;
};

/**
 * After a save the server answered, a screen stays busy (its form inert)
 * until the refreshed page replaces it: anything typed in between would be
 * dropped when it lands. That page can stall (offline, an interrupted
 * response), so the wait is bounded: after `waitMs`, `retry` loads it once
 * more (a router refresh, or the navigation again; never the save itself);
 * if it still isn't here `waitMs` later, or the retry throws or rejects,
 * `giveUp` runs once, and the screen stops being busy and says so.
 */
export function waitForRefresh({
  retry,
  giveUp,
  waitMs = REFRESH_WAIT_MS,
  timers = realTimers,
}: {
  retry: () => unknown;
  giveUp: () => void;
  waitMs?: number;
  timers?: Timers;
}): RefreshWait {
  let phase: RefreshWaitPhase = "waiting";
  const open = () => phase === "waiting" || phase === "retrying";
  const failed = () => {
    if (!open()) return;
    timers.clear(timer);
    phase = "gave-up";
    giveUp();
  };
  const timedOut = () => {
    if (phase === "retrying") return failed();
    if (phase !== "waiting") return;
    phase = "retrying";
    timer = timers.set(timedOut, waitMs);
    try {
      const loading = retry();
      if (loading instanceof Promise) loading.catch(failed);
    } catch {
      failed();
    }
  };
  let timer = timers.set(timedOut, waitMs);
  return {
    phase: () => phase,
    arrived: () => {
      if (!open()) return;
      timers.clear(timer);
      phase = "arrived";
    },
    failed,
  };
}

export type RefreshWaitStart = {
  /** A navigation to run now and again as the retry; none: the action's own refresh is on its way, and the retry is `refresh`. */
  load?: () => void;
  refresh: () => void;
  giveUp: () => void;
};

/**
 * One screen's waits for the refreshed page, live only while the screen is
 * mounted. A save's answer can come after the screen was left (the person
 * navigated away while it was in flight): start() then does nothing at all,
 * so no navigation, refresh or toast reaches the screen now shown. Leaving
 * stops the wait in progress, and its retry and give-up run only while the
 * screen that started it is still here.
 */
export function refreshWaits(make: typeof waitForRefresh = waitForRefresh) {
  let live = false;
  let current: RefreshWait | null = null;
  const stop = () => {
    current?.arrived();
    current = null;
  };
  return {
    mount() {
      live = true;
    },
    unmount() {
      live = false;
      stop();
    },
    /** Whether a wait started: false once the screen is gone. */
    start({ load, refresh, giveUp }: RefreshWaitStart): boolean {
      if (!live) return false;
      stop();
      load?.();
      current = make({
        retry: () => (live ? (load ?? refresh)() : undefined),
        giveUp: () => {
          if (live) giveUp();
        },
      });
      return true;
    },
    arrived: stop,
  };
}
