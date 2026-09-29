// The bounded wait for the refreshed page after a save the server answered
// (src/lib/app/save.ts): wait, load it once more, then give up, never twice
// and never after it arrived; and only for the screen that started it. The screens' side: tests/e2e/library.spec.ts
// and tests/e2e/today.spec.ts (the refresh held after the save succeeds).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_STALLED, REFRESH_WAIT_MS, refreshWaits, waitForRefresh } from "@/lib/app/save";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const start = (retry: () => unknown = () => undefined) => {
  const calls = { retry: 0, giveUp: 0 };
  const wait = waitForRefresh({
    retry: () => {
      calls.retry += 1;
      return retry();
    },
    giveUp: () => {
      calls.giveUp += 1;
    },
  });
  return { wait, calls };
};

describe("waitForRefresh", () => {
  it("waits about 8 to 10 s each time, and says the page is the one from before", () => {
    expect(REFRESH_WAIT_MS).toBeGreaterThanOrEqual(8_000);
    expect(REFRESH_WAIT_MS).toBeLessThanOrEqual(10_000);
    expect(`Saved. ${REFRESH_STALLED}`).toBe("Saved. Couldn't load the latest version.");
  });

  it("stays waiting (busy) until the refreshed page arrives, and then stops quietly", () => {
    const { wait, calls } = start();
    vi.advanceTimersByTime(REFRESH_WAIT_MS - 1);
    expect(wait.phase()).toBe("waiting");
    expect(calls).toEqual({ retry: 0, giveUp: 0 });
    wait.arrived();
    expect(wait.phase()).toBe("arrived");
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ retry: 0, giveUp: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loads the page once more after the wait, and stops if that one arrives", () => {
    const { wait, calls } = start();
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(wait.phase()).toBe("retrying");
    expect(calls).toEqual({ retry: 1, giveUp: 0 });
    vi.advanceTimersByTime(REFRESH_WAIT_MS - 1);
    wait.arrived();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(wait.phase()).toBe("arrived");
    expect(calls).toEqual({ retry: 1, giveUp: 0 });
  });

  it("gives up once, after the one retry's wait, and a late arrival changes nothing", () => {
    const { wait, calls } = start();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 2 - 1);
    expect(calls).toEqual({ retry: 1, giveUp: 0 });
    vi.advanceTimersByTime(1);
    expect(wait.phase()).toBe("gave-up");
    expect(calls).toEqual({ retry: 1, giveUp: 1 });
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    wait.arrived();
    wait.failed();
    expect(wait.phase()).toBe("gave-up");
    expect(calls).toEqual({ retry: 1, giveUp: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up at once when the retry throws", () => {
    const { wait, calls } = start(() => {
      throw new Error("offline");
    });
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(wait.phase()).toBe("gave-up");
    expect(calls).toEqual({ retry: 1, giveUp: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up as soon as the retry rejects (the refresh errored)", async () => {
    const { wait, calls } = start(() => Promise.reject(new Error("interrupted")));
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(calls).toEqual({ retry: 1, giveUp: 0 });
    await Promise.resolve();
    expect(wait.phase()).toBe("gave-up");
    expect(calls).toEqual({ retry: 1, giveUp: 1 });
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ retry: 1, giveUp: 1 });
  });

  it("gives up at once when loading fails while still waiting, and never retries after", () => {
    const { wait, calls } = start();
    vi.advanceTimersByTime(1_000);
    wait.failed();
    expect(wait.phase()).toBe("gave-up");
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ retry: 0, giveUp: 1 });
  });

  it("never retries more than once, however long the page stalls", () => {
    const { calls } = start();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 20);
    expect(calls).toEqual({ retry: 1, giveUp: 1 });
  });
});

describe("refreshWaits (one screen's waits)", () => {
  const screen = () => {
    const calls = { load: 0, refresh: 0, giveUp: 0 };
    const waits = refreshWaits();
    const start = (navigates: boolean) =>
      waits.start({
        load: navigates ? () => void (calls.load += 1) : undefined,
        refresh: () => void (calls.refresh += 1),
        giveUp: () => void (calls.giveUp += 1),
      });
    return { waits, calls, start };
  };

  it("does nothing at all when the answer comes after the screen was left: no navigation, refresh, toast or timer", () => {
    const { waits, calls, start } = screen();
    waits.mount();
    waits.unmount();
    expect(start(true)).toBe(false);
    expect(start(false)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ load: 0, refresh: 0, giveUp: 0 });
  });

  it("does nothing before the screen is mounted", () => {
    const { calls, start } = screen();
    expect(start(false)).toBe(false);
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ load: 0, refresh: 0, giveUp: 0 });
  });

  it("while mounted: the action's refresh is awaited, then one router refresh, then the give-up", () => {
    const { waits, calls, start } = screen();
    waits.mount();
    expect(start(false)).toBe(true);
    expect(calls).toEqual({ load: 0, refresh: 0, giveUp: 0 });
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(calls).toEqual({ load: 0, refresh: 1, giveUp: 0 });
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(calls).toEqual({ load: 0, refresh: 1, giveUp: 1 });
  });

  it("a navigation runs at once and again as the retry, never a refresh", () => {
    const { waits, calls, start } = screen();
    waits.mount();
    start(true);
    expect(calls).toEqual({ load: 1, refresh: 0, giveUp: 0 });
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 2);
    expect(calls).toEqual({ load: 2, refresh: 0, giveUp: 1 });
  });

  it("leaving the screen stops the wait: no retry or give-up reaches the screen now shown", () => {
    const { waits, calls, start } = screen();
    waits.mount();
    start(false);
    vi.advanceTimersByTime(REFRESH_WAIT_MS - 1);
    waits.unmount();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ load: 0, refresh: 0, giveUp: 0 });
    expect(vi.getTimerCount()).toBe(0);

    const retrying = screen();
    retrying.waits.mount();
    retrying.start(true);
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    retrying.waits.unmount();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(retrying.calls).toEqual({ load: 2, refresh: 0, giveUp: 0 });
  });

  it("keeps one wait at a time, and arrived() stops it", () => {
    const { waits, calls, start } = screen();
    waits.mount();
    start(false);
    vi.advanceTimersByTime(REFRESH_WAIT_MS - 1);
    start(false);
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 2);
    expect(calls).toEqual({ load: 0, refresh: 1, giveUp: 1 });
    start(false);
    waits.arrived();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(calls).toEqual({ load: 0, refresh: 1, giveUp: 1 });
  });

  it("keyed waits run side by side: a second key keeps the first's wait, and arrived(key) stops only that one", () => {
    const waits = refreshWaits();
    const gaveUp: string[] = [];
    const start = (key: string) => waits.start({ key, refresh: () => undefined, giveUp: () => void gaveUp.push(key) });
    waits.mount();
    start("A");
    vi.advanceTimersByTime(REFRESH_WAIT_MS / 2);
    start("B");
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 1.5);
    // A's two rounds are over; B has half a round left.
    expect(gaveUp).toEqual(["A"]);
    vi.advanceTimersByTime(REFRESH_WAIT_MS / 2);
    expect(gaveUp).toEqual(["A", "B"]);

    start("A");
    start("B");
    waits.arrived("A");
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(gaveUp).toEqual(["A", "B", "B"]);
    // Unnamed, arrived() ends every wait; leaving the screen does too.
    start("A");
    start("B");
    waits.arrived();
    start("C");
    waits.unmount();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(gaveUp).toEqual(["A", "B", "B"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("works again after a remount (React's development double effects)", () => {
    const { waits, calls, start } = screen();
    waits.mount();
    waits.unmount();
    waits.mount();
    expect(start(false)).toBe(true);
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 2);
    expect(calls).toEqual({ load: 0, refresh: 1, giveUp: 1 });
  });
});
