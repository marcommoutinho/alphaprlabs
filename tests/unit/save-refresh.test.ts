// The bounded wait for the refreshed page after a save the server answered
// (src/lib/app/save.ts): wait, load it once more, then give up, never twice
// and never after it arrived. The screens' side: tests/e2e/library.spec.ts
// and tests/e2e/today.spec.ts (the refresh held after the save succeeds).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_STALLED, REFRESH_WAIT_MS, waitForRefresh } from "@/lib/app/save";

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
