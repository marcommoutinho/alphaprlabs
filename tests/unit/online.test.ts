// The app's view of the connection (src/components/alpha/online.ts): a
// request that fails with a network error marks the app offline, and while
// that is the only sign a small check runs now and then. A check that gets
// no answer is cancelled after PROBE_TIMEOUT_MS and counts as still offline,
// so a stalled one never leaves every save control disabled. The screens'
// side: tests/e2e/offline.spec.ts.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A page with the observer installed: `pageFetch` is the browser's own fetch. */
async function page() {
  const pageFetch = vi.fn<typeof fetch>();
  const events = new Map<string, () => void>();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { fetch: pageFetch, addEventListener: (type: string, listener: () => void) => events.set(type, listener) });
  const online = await import("@/components/alpha/online");
  const followed: string[] = [];
  online.whenOnline(() => followed.push("followed")); // installs the observer
  // A request of the app's fails with a network error: offline.
  pageFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(window.fetch("/app/today")).rejects.toThrow("Failed to fetch");
  expect(online.isOnline()).toBe(false);
  return { online, pageFetch, events, followed };
}

it("a connection check that stalls times out and counts as offline; the next one that answers brings the app back online", async () => {
  const { online, pageFetch, followed } = await page();
  let signal: AbortSignal | null | undefined;
  pageFetch.mockImplementationOnce((_, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => undefined); // never answers
  });

  await vi.advanceTimersByTimeAsync(1_000);
  expect(pageFetch).toHaveBeenCalledTimes(2);
  expect(pageFetch.mock.calls[1]).toEqual(["/manifest.webmanifest", expect.objectContaining({ method: "HEAD", cache: "no-store" })]);
  await vi.advanceTimersByTimeAsync(online.PROBE_TIMEOUT_MS - 1);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted).toBe(true);
  expect(online.isOnline()).toBe(false);
  expect(followed).toEqual([]);

  pageFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
  await vi.advanceTimersByTimeAsync(2_999);
  expect(pageFetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(pageFetch).toHaveBeenCalledTimes(3);
  expect(online.isOnline()).toBe(true);
  expect(followed).toEqual(["followed"]);
  // Online: no more checks.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(pageFetch).toHaveBeenCalledTimes(3);
});

it("a check that fails keeps checking every few seconds, and any answer to the app's own requests ends it", async () => {
  const { online, pageFetch } = await page();
  pageFetch.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await vi.advanceTimersByTimeAsync(1_000 + 3_000);
  expect(pageFetch).toHaveBeenCalledTimes(3);
  expect(online.isOnline()).toBe(false);

  pageFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
  await window.fetch("/app/today");
  expect(online.isOnline()).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(pageFetch).toHaveBeenCalledTimes(4);
});

it("a follow-up that was cancelled doesn't run when the connection is back", async () => {
  const { online, pageFetch, events } = await page();
  const followed: string[] = [];
  const cancel = online.whenOnline(() => followed.push("late"));
  cancel();
  pageFetch.mockResolvedValue(new Response(null, { status: 200 }));
  events.get("online")?.();
  expect(online.isOnline()).toBe(true);
  expect(followed).toEqual([]);
});
