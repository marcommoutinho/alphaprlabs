// A page put back by Back or Forward asks for itself again (restoreWait in
// src/lib/app/save.ts, used by the Library's and a peptide's RestoreGate):
// never a wait without end. It asks now, once more after the usual wait,
// then fails (the screen's error with Try again); Try again or coming back
// online asks again; offline it doesn't ask at all. The screens' side:
// tests/e2e/instant-feel.spec.ts and tests/e2e/back-forward-cache.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFRESH_WAIT_MS, type RestorePhase, restoreWait } from "@/lib/app/save";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function gate({ online = true, refresh = () => undefined as unknown } = {}) {
  const state = { online, refreshes: 0, phases: [] as RestorePhase[] };
  const restore = restoreWait({
    refresh: () => {
      state.refreshes += 1;
      return refresh();
    },
    onPhase: (phase) => state.phases.push(phase),
    online: () => state.online,
  });
  return { restore, state };
}

describe("restoreWait", () => {
  it("asks now, once more after the wait, then fails; nothing more after that", () => {
    const { restore, state } = gate();
    restore.start();
    expect(state.refreshes).toBe(1);
    expect(restore.phase()).toBe("restoring");
    vi.advanceTimersByTime(REFRESH_WAIT_MS - 1);
    expect(state.refreshes).toBe(1);
    vi.advanceTimersByTime(1);
    expect(state.refreshes).toBe(2);
    expect(restore.phase()).toBe("restoring");
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(restore.phase()).toBe("failed");
    expect(state.phases).toEqual(["failed"]);
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 5);
    expect(state.refreshes).toBe(2);
  });

  it("Try again (or back online) asks again and waits again, from the start", () => {
    const { restore, state } = gate();
    restore.start();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 2);
    expect(restore.phase()).toBe("failed");
    restore.again();
    expect(state.refreshes).toBe(3);
    expect(restore.phase()).toBe("restoring");
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(state.refreshes).toBe(4);
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(state.phases).toEqual(["failed", "restoring", "failed"]);
  });

  it("stops quietly once the fresh page is here (or the page is gone)", () => {
    const { restore, state } = gate();
    restore.start();
    restore.done();
    vi.advanceTimersByTime(REFRESH_WAIT_MS * 3);
    expect(state.refreshes).toBe(1);
    expect(state.phases).toEqual([]);
    restore.again();
    expect(state.refreshes).toBe(1);
  });

  it("offline, doesn't ask (a full page load would follow) and fails at once; back online, it asks", () => {
    const { restore, state } = gate({ online: false });
    restore.start();
    expect(state.refreshes).toBe(0);
    expect(restore.phase()).toBe("failed");
    // Offline by the retry: it fails then, without asking.
    const later = gate();
    later.restore.start();
    later.state.online = false;
    vi.advanceTimersByTime(REFRESH_WAIT_MS);
    expect(later.state.refreshes).toBe(1);
    expect(later.restore.phase()).toBe("failed");

    state.online = true;
    restore.again();
    expect(state.refreshes).toBe(1);
    expect(restore.phase()).toBe("restoring");
  });

  it("a refresh that throws or rejects fails at once", async () => {
    const thrown = gate({
      refresh: () => {
        throw new Error("no router");
      },
    });
    thrown.restore.start();
    expect(thrown.restore.phase()).toBe("failed");
    const rejected = gate({ refresh: () => Promise.reject(new Error("network")) });
    rejected.restore.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected.restore.phase()).toBe("failed");
  });
});
