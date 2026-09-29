// How the installed research app feels on a phone (slice N1 "Instant feel"):
// a repeatable measurement, not a test of the normal suite. Runs only with
// PERF=1, from its own config:
//
//   PERF=1 E2E_PORT=3261 [PERF_OUT=feel.json] [PERF_RUNS=5] \
//     npx playwright test -c tests/perf/playwright.config.ts
//
// Production build (next build && next start) on the local Supabase, a
// 390×844 phone (Chromium, touch), and CDP throttling: Fast 4G (150 ms RTT,
// 9 Mbps down, 1.5 Mbps up) and a 4× CPU slowdown. The HTTP cache is warm
// (one warm-up of each scenario first), as on a phone that has opened the
// app before; every measurement starts from a new page, so the client router
// cache is empty unless the scenario visits a tab first. Times are in ms,
// from the page's own monotonic clock (performance.now), and a state counts
// as shown at the first animation frame in which it is in the DOM and laid
// out. The median of PERF_RUNS (5) runs is reported:
//
//   (a) launch: navigation start at the manifest's start_url (redirects
//       included) to the first contentful paint, to the app frame (the tab
//       bar), and to Today's content (the Now block, nothing still loading);
//   (b) a tab tap, for each ordered pair of the researcher's five tabs (and
//       Today ↔ Business for an admin), 1.5 s after the first tab's content
//       showed: to the first visible change (the tapped tab active, a
//       skeleton, or the new page) and to the new content (its heading, the
//       URL, and nothing still loading);
//   (c) Taken on the Now block's due dose: to the visible tick (its Schedule
//       row says Taken) and to the server's confirmation (the Undo toast);
//   (d) back to a tab visited a moment ago: Today → Cycles, then the Today
//       tab (d1) or the browser's Back (d2).
//
// A second test reports each page's server time (no throttling, local
// server and Supabase): a signed-in fetch of the page's HTML (a launch) and
// of its RSC payload (a navigation), to the first body chunk (the first
// flush: the shell and its skeleton, when the page streams) and to the end
// of the stream (every query done). Median of SERVER_RUNS (10).
import { type Browser, type BrowserContext, expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { APP_ORIGIN } from "../../playwright.config";
import { hydrated, signInAs } from "../support/local-supabase";
import { seedPerf, type PerfSeed } from "./seed";

test.skip(!process.env.PERF, "The feel measurement runs only with PERF=1.");

const RUNS = Number(process.env.PERF_RUNS ?? 5);
/** How long a person looks at a screen before tapping on (prefetches, if any, run meanwhile). */
const DWELL_MS = 1_500;

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});

// ── In-page probes ──────────────────────────────────────────────────────────

type Probe =
  | { kind: "appFrame" }
  | { kind: "tabActive"; href: string }
  | { kind: "skeleton" }
  | { kind: "content"; path: string; h1: string; selector?: string }
  | { kind: "doseTaken"; name: string }
  | { kind: "toast"; text: string }
  | { kind: "any"; of: Probe[] };

type Watch = { start: number; at: Record<string, number | null> };

declare global {
  interface Window {
    __feel: {
      /** Watches from document start (the launch). */
      launch: Promise<Watch> | null;
      startLaunch: (probes: Record<string, Probe>) => void;
      /** Arms a watch that starts at the next tap (pointerdown / click) or history move (popstate). */
      arm: (probes: Record<string, Probe>) => void;
      result: (timeoutMs: number) => Promise<Watch>;
      /** Resolves once the probe holds. */
      until: (probe: Probe) => Promise<void>;
    };
  }
}

/** Installed in every document before its own scripts. */
function installProbes() {
  const shown = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0;
  const holds = (probe: Probe): boolean => {
    switch (probe.kind) {
      case "appFrame":
        return [...document.querySelectorAll('nav[aria-label="Main"]')].some(shown);
      case "tabActive":
        return [...document.querySelectorAll(`nav[aria-label="Main"] a[href="${probe.href}"][aria-current="page"]`)].some(shown);
      case "skeleton":
        return [...document.querySelectorAll('main [data-slot="skeleton"]')].some(shown);
      case "content": {
        if (location.pathname !== probe.path) return false;
        if ([...document.querySelectorAll('[aria-busy="true"]')].some(shown)) return false;
        if (probe.selector && ![...document.querySelectorAll(probe.selector)].some(shown)) return false;
        return [...document.querySelectorAll("h1")].some((h) => shown(h) && h.textContent?.trim() === probe.h1);
      }
      case "doseTaken":
        return [...document.querySelectorAll('[data-testid="today-row"][data-kind="today"]')].some(
          (row) => shown(row) && (row.querySelector('[data-testid="today-row-title"]')?.textContent ?? "").startsWith(probe.name) && (row.getAttribute("data-status") ?? "").startsWith("Taken"),
        );
      case "toast":
        return [...document.querySelectorAll('[role="status"]')].some((el) => shown(el) && (el.textContent ?? "").includes(probe.text));
      case "any":
        return probe.of.some(holds);
    }
  };
  let watching: { probes: Record<string, Probe>; at: Record<string, number | null> } | null = null;
  const watch = (probes: Record<string, Probe>, start: number | Promise<number>) => {
    const at: Record<string, number | null> = Object.fromEntries(Object.keys(probes).map((name) => [name, null]));
    watching = { probes, at };
    let done!: () => void;
    const finished = new Promise<void>((resolve) => (done = resolve));
    const tick = () => {
      const now = performance.now();
      for (const [name, probe] of Object.entries(probes)) if (at[name] === null && holds(probe)) at[name] = now;
      if (Object.values(at).every((value) => value !== null)) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return Promise.all([Promise.resolve(start), finished]).then(([begin]) => ({ start: begin, at }));
  };

  let armed: Promise<Watch> | null = null;
  window.__feel = {
    launch: null,
    startLaunch(probes) {
      this.launch = watch(probes, 0);
    },
    arm(probes) {
      const start = new Promise<number>((resolve) => {
        const events = ["pointerdown", "mousedown", "touchstart", "click", "popstate"];
        const once = (event: Event) => {
          for (const type of events) window.removeEventListener(type, once, true);
          resolve(event.timeStamp);
        };
        for (const type of events) window.addEventListener(type, once, true);
      });
      armed = watch(probes, start);
    },
    result(timeoutMs) {
      const pending = armed ?? this.launch;
      if (!pending) return Promise.reject(new Error("Nothing armed"));
      const timedOut = () => {
        const busy = [...document.querySelectorAll('[aria-busy="true"]')].filter(shown).map((el) => el.outerHTML.slice(0, 120));
        const h1s = [...document.querySelectorAll("h1")].map((h) => `${shown(h)}:${h.textContent?.trim()}`);
        return new Error(`probe timeout at ${location.pathname}: ${JSON.stringify(watching?.at)} busy=${JSON.stringify(busy)} h1=${JSON.stringify(h1s)}`);
      };
      return Promise.race([pending, new Promise<Watch>((_, reject) => setTimeout(() => reject(timedOut()), timeoutMs))]);
    },
    until(probe) {
      return watch({ ready: probe }, 0).then(() => undefined);
    },
  };
}

// ── Throttled pages ─────────────────────────────────────────────────────────

async function phonePage(context: import("@playwright/test").BrowserContext, launchProbes?: Record<string, Probe>): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(installProbes);
  if (launchProbes) await page.addInitScript((probes) => window.__feel.startLaunch(probes), launchProbes);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return page;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

type Tab = { key: string; href: string; h1: string; selector?: string };
const researcherTabs = (seed: PerfSeed): Tab[] => [
  { key: "Today", href: "/app/today", h1: "Today", selector: '[data-testid="today-hero"]' },
  { key: "Cycles", href: "/app/cycles", h1: "Cycles" },
  { key: "Progress", href: "/app/progress", h1: "Progress" },
  { key: "Library", href: "/app/library", h1: "Library" },
  { key: "Me", href: "/app/me", h1: seed.researcher.name },
];
const TODAY_ADMIN: Tab = { key: "Today", href: "/app/today", h1: "Today" };
const BUSINESS: Tab = { key: "Business", href: "/admin/business", h1: "Business" };

const contentOf = (tab: Tab): Probe => ({ kind: "content", path: tab.href, h1: tab.h1, selector: tab.selector });

async function waitFor(page: Page, probe: Probe) {
  await page.evaluate((p) => window.__feel.until(p), probe);
}

/** Opens `tab` in a new throttled page and lets it settle. */
async function openAt(context: import("@playwright/test").BrowserContext, tab: Tab): Promise<Page> {
  const page = await phonePage(context);
  await page.goto(`${APP_ORIGIN}${tab.href}`, { waitUntil: "commit" });
  await waitFor(page, contentOf(tab));
  await page.waitForTimeout(DWELL_MS);
  return page;
}

const tabLink = (page: Page, tab: Tab) => page.getByRole("navigation", { name: "Main" }).locator(`a[href="${tab.href}"]`);

/** Taps `to`'s tab: ms to the first visible change and to the new content. */
async function tapTab(page: Page, to: Tab): Promise<{ first: number; content: number }> {
  const link = await hydrated(tabLink(page, to));
  await page.evaluate(
    (probes) => window.__feel.arm(probes),
    { first: { kind: "any", of: [{ kind: "tabActive", href: to.href }, { kind: "skeleton" }, contentOf(to)] }, content: contentOf(to) } as Record<string, Probe>,
  );
  await link.click();
  const { start, at } = await page.evaluate(() => window.__feel.result(60_000));
  return { first: at.first! - start, content: at.content! - start };
}

// ── The measurement ─────────────────────────────────────────────────────────

/** A phone context signed in as `email` (sign-in itself unthrottled). */
async function signedInContext(browser: Browser, email: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(/\/app\/today/);
  await page.close();
  return context;
}

type Sample = Record<string, number[]>;

test("feel: launch, tabs, Taken and revisits on a throttled phone", async ({ browser }) => {
  const seed = await seedPerf();
  const samples: Sample = {};
  const add = (name: string, value: number) => (samples[name] ??= []).push(Math.round(value));

  const signedIn = (email: string) => signedInContext(browser, email);
  const researcher = await signedIn(seed.researcher.email);
  const admin = await signedIn(seed.admin.email);
  // From a page: Playwright's own process doesn't resolve *.localhost.
  const reader = await researcher.newPage();
  await reader.goto(`${APP_ORIGIN}/manifest.webmanifest`);
  const startUrl: string = await reader.evaluate(async () => (await (await fetch("/manifest.webmanifest")).json()).start_url);
  await reader.close();
  const tabs = researcherTabs(seed);

  // (a) Launch at the manifest's start_url.
  const launch = async () => {
    const page = await phonePage(researcher, {
      appFrame: { kind: "appFrame" },
      content: contentOf(tabs[0]),
    });
    await page.goto(`${APP_ORIGIN}${startUrl}`, { waitUntil: "commit" });
    const { at } = await page.evaluate(() => window.__feel.result(60_000));
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? NaN);
    const redirects = await page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).redirectCount);
    await page.close();
    return { fcp, appFrame: at.appFrame!, content: at.content!, redirects };
  };

  // (b) One tab tap from a fresh page at `from`.
  const pair = async (context: typeof researcher, from: Tab, to: Tab) => {
    const page = await openAt(context, from);
    const result = await tapTab(page, to);
    await page.close();
    return result;
  };

  // (c) Taken on the Now block's dose.
  const taken = async () => {
    const page = await openAt(researcher, tabs[0]);
    const hero = page.getByTestId("today-hero");
    const name = (await hero.getByTestId("hero-name").textContent())!.trim();
    const button = await hydrated(hero.getByRole("button", { name: "Taken" }));
    await page.evaluate(
      (dose) => window.__feel.arm({ tick: { kind: "doseTaken", name: dose }, confirmed: { kind: "toast", text: `${dose} ·` } }),
      name,
    );
    await button.click();
    const { start, at } = await page.evaluate(() => window.__feel.result(60_000));
    // Let the save and its refreshed page land before the next run.
    await expect(page.getByTestId("today-hero").getByTestId("hero-name")).not.toHaveText(name);
    await page.close();
    return { tick: at.tick! - start, confirmed: at.confirmed! - start };
  };

  // (d) Back to Today after a moment on Cycles: its tab, or the browser's Back.
  const revisit = async (how: "tab" | "back") => {
    const page = await openAt(researcher, tabs[0]);
    await tapTab(page, tabs[1]);
    await page.waitForTimeout(DWELL_MS);
    if (how === "tab") {
      const result = await tapTab(page, tabs[0]);
      await page.close();
      return result;
    }
    await page.evaluate(
      (probes) => window.__feel.arm(probes),
      { first: { kind: "any", of: [{ kind: "tabActive", href: tabs[0].href }, { kind: "skeleton" }, contentOf(tabs[0])] }, content: contentOf(tabs[0]) } as Record<string, Probe>,
    );
    await page.goBack({ waitUntil: "commit" });
    const { start, at } = await page.evaluate(() => window.__feel.result(60_000));
    await page.close();
    return { first: at.first! - start, content: at.content! - start };
  };

  // Warm-up (not counted): HTTP cache, server code paths.
  await launch();
  for (const tab of tabs.slice(1)) await pair(researcher, tabs[0], tab);
  await pair(admin, TODAY_ADMIN, BUSINESS);
  await taken();

  const redirectCounts: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const a = await launch();
    add("a launch → first contentful paint", a.fcp);
    add("a launch → app frame", a.appFrame);
    add("a launch → Today content", a.content);
    redirectCounts.push(a.redirects);

    for (const from of tabs)
      for (const to of tabs) {
        if (from === to) continue;
        const b = await pair(researcher, from, to);
        add(`b ${from.key} → ${to.key}: first change`, b.first);
        add(`b ${from.key} → ${to.key}: content`, b.content);
        add("b all researcher pairs: first change", b.first);
        add("b all researcher pairs: content", b.content);
      }
    for (const [from, to] of [
      [TODAY_ADMIN, BUSINESS],
      [BUSINESS, TODAY_ADMIN],
    ]) {
      const b = await pair(admin, from, to);
      add(`b admin ${from.key} → ${to.key}: first change`, b.first);
      add(`b admin ${from.key} → ${to.key}: content`, b.content);
    }

    const c = await taken();
    add("c Taken → tick", c.tick);
    add("c Taken → server confirmation", c.confirmed);

    const d1 = await revisit("tab");
    add("d1 Today tab again: first change", d1.first);
    add("d1 Today tab again: content", d1.content);
    const d2 = await revisit("back");
    add("d2 Back to Today: first change", d2.first);
    add("d2 Back to Today: content", d2.content);
  }

  const rows = Object.entries(samples).map(([name, values]) => ({ name, median: median(values), values }));
  const table = [
    `start_url ${startUrl} · redirects per launch ${redirectCounts.join(",")} · ${RUNS} runs`,
    "| measurement | median ms | runs |",
    "| --- | ---: | --- |",
    ...rows.map((row) => `| ${row.name} | ${row.median} | ${row.values.join(" ")} |`),
  ].join("\n");
  console.log(`\n${table}\n`);
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify({ startUrl, redirectCounts, rows }, null, 2));
  await researcher.close();
  await admin.close();
});


const SERVER_RUNS = Number(process.env.PERF_SERVER_RUNS ?? 10);

test("server time per page: first flush and whole page, HTML and RSC", async ({ browser }) => {
  const seed = await seedPerf();
  const researcher = await signedInContext(browser, seed.researcher.email);
  const admin = await signedInContext(browser, seed.admin.email);
  const rows: { name: string; median: number; values: number[] }[] = [];
  const pages: [BrowserContext, string][] = [
    ...["/app/today", "/app/cycles", "/app/progress", "/app/library", "/app/me", "/app/supplies"].map((path) => [researcher, path] as [BrowserContext, string]),
    [admin, "/admin/business"],
  ];
  for (const [context, path] of pages) {
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/manifest.webmanifest`);
    for (const kind of ["HTML", "RSC"] as const) {
      const first: number[] = [];
      const total: number[] = [];
      // An RSC request's URL carries a hash of its headers (?_rsc=): the warm-up learns it.
      let url = path;
      for (let run = 0; run <= SERVER_RUNS; run += 1) {
        const time = await page.evaluate(
          async ({ url, rsc }) => {
            const start = performance.now();
            const response = await fetch(url, { cache: "no-store", headers: rsc ? { RSC: "1" } : {} });
            if (!response.ok || (response.redirected && !rsc)) throw new Error(`${url}: ${response.status}${response.redirected ? ` → ${response.url}` : ""}`);
            const reader = response.body!.getReader();
            let firstChunk: number | null = null;
            for (;;) {
              const { done } = await reader.read();
              firstChunk ??= performance.now() - start;
              if (done) break;
            }
            return { first: firstChunk, total: performance.now() - start, url: response.url };
          },
          { url, rsc: kind === "RSC" },
        );
        if (run === 0) {
          // Warm-up.
          url = new URL(time.url).pathname + new URL(time.url).search;
          continue;
        }
        first.push(Math.round(time.first));
        total.push(Math.round(time.total));
      }
      rows.push({ name: `${path} ${kind}: first flush`, median: median(first), values: first });
      rows.push({ name: `${path} ${kind}: whole page`, median: median(total), values: total });
    }
    await page.close();
  }
  const table = ["| page | median ms | runs |", "| --- | ---: | --- |", ...rows.map((row) => `| ${row.name} | ${row.median} | ${row.values.join(" ")} |`)].join("\n");
  console.log(`\n${table}\n`);
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT.replace(/(\.json)?$/, ".server.json"), JSON.stringify({ rows }, null, 2));
  await researcher.close();
  await admin.close();
});
