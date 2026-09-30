// Is vercel/next.js#98684 fixed in the Next.js we run? (slice N1: the
// private app's links stay unprefetched until it is, src/components/alpha/link.tsx.)
// A stress repro, not a test of the normal suite. Runs only with PERF=1:
//
//   PERF=1 E2E_PORT=3261 [STRESS_TAPS=300] [PERF_OUT=stress.json] \
//     npx playwright test -c tests/perf/playwright.config.ts prefetch-stress
//
// The issue: a <Link> followed while its prefetch is still in flight can
// commit an empty segment (no page, no skeleton, no error, or an empty
// document title) that stays until a reload. As reported, the pending
// prefetch entry is rejected when the page has no loading.tsx of its own (the
// prefetch answers with the route tree only), typically when a second link is
// followed while the first navigation is still pending. Its conditions are
// made likely here: a throttled phone (Fast 4G, 4× CPU), every prefetch
// request held HOLD_MS before it goes out, and taps as soon as a link is
// interactive, often right after a reload (every tab's prefetch starts again)
// or on a link that has just mounted.
//
//   1. single taps: a tab, then a link that has just mounted on it (a cycle
//      card, a Library peptide, Today's calculator link);
//   2. double taps: a link, then another 0-250 ms later while the first is
//      pending, most landing on a page without its own loading.tsx
//      (the calculator, Me's disclaimer and reminders).
//
// Every tap must end on its destination: its heading and a document title.
// One that doesn't (within SETTLE_MS) is a failure, recorded with what `main`
// showed, and the run goes on from a reload. Run once against a build whose
// links prefetch (the evidence) and once as shipped (no prefetch).
import { type Browser, expect, test, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { d, NOON } from "../support/noon";

test.skip(!process.env.PERF, "The prefetch stress runs only with PERF=1.");

const TAPS = Number(process.env.STRESS_TAPS ?? 300);
const HOLD_MS = 1_500;
const SETTLE_MS = 12_000;
const NAME = "Stress Researcher";

async function seed() {
  const t = tag();
  const email = uniqueEmail("stress");
  await ensureAccount({ email, name: NAME, role: "researcher" });
  const peptide = `Stress BPC ${t}`;
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name: peptide, information: `[Supplied information for ${peptide}]`, available: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${peptide}: ${error?.message ?? "no row"}`);
  const name = `Stress cycle ${t}`;
  const cycleId = await createCycle(await signedInClient(email), {
    name,
    timeZone: NOON,
    plans: [plan(data.id, [interval(d(-1), d(20), "0.25", 1, "08:00")])],
  });
  return { email, name, cycleId };
}

/** A small deterministic generator, so a run's tap sequence can be repeated. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

type Failure = { tap: number; step: string; url: string; title: string; h1: string[]; main: string; skeletons: number };
type Destination = { link: Locator; url: RegExp | string; h1: RegExp | string };

/** A signed-in, throttled phone whose prefetch requests are each held HOLD_MS, with the tap-and-check loop's bookkeeping. */
async function stressPage(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  const stats = { taps: 0, tapsDuringPrefetch: 0, prefetches: 0, heldInFlight: 0, failures: [] as Failure[] };
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (!headers["next-router-prefetch"] && !headers["next-router-segment-prefetch"]) return route.continue();
    stats.prefetches += 1;
    stats.heldInFlight += 1;
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    stats.heldInFlight -= 1;
    await route.continue().catch(() => undefined);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const heading = page.getByRole("heading", { level: 1 });
  const tab = (label: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${label}( \\d+)?$`) });
  const tabs = {
    Today: { link: tab("Today"), url: `${APP_ORIGIN}/app/today`, h1: "Today" },
    Cycles: { link: tab("Cycles"), url: `${APP_ORIGIN}/app/cycles`, h1: "Cycles" },
    Progress: { link: tab("Progress"), url: `${APP_ORIGIN}/app/progress`, h1: "Progress" },
    Library: { link: tab("Library"), url: `${APP_ORIGIN}/app/library`, h1: "Library" },
    Me: { link: tab("Me"), url: `${APP_ORIGIN}/app/me`, h1: NAME },
  } satisfies Record<string, Destination>;

  const tapped = async (link: Locator, timeout?: number) => {
    stats.taps += 1;
    if (stats.heldInFlight > 0) stats.tapsDuringPrefetch += 1;
    await link.tap({ timeout });
  };

  /** Checks the page ended on `to`; a failure is recorded, then a reload. */
  async function settled(step: string, to: Destination) {
    try {
      await expect(page).toHaveURL(to.url, { timeout: SETTLE_MS });
      await expect(heading).toHaveText(to.h1, { timeout: SETTLE_MS });
      await expect.poll(() => page.title(), { timeout: SETTLE_MS }).not.toBe("");
    } catch {
      stats.failures.push({
        tap: stats.taps,
        step,
        url: page.url(),
        title: await page.title().catch(() => "?"),
        h1: await heading.allTextContents().catch(() => []),
        main: ((await page.locator("main").last().innerHTML().catch(() => "")) ?? "").slice(0, 400),
        skeletons: await page.locator("main [data-slot=skeleton]").count(),
      });
      console.log(`FAILURE ${stats.failures.length} at tap ${stats.taps} (${step}): ${JSON.stringify(stats.failures.at(-1))}`);
      await page.goto(`${APP_ORIGIN}/app/today`);
      await expect(heading).toHaveText("Today");
    }
  }

  /** Taps `to` as soon as it is interactive, then checks it rendered. */
  async function single(step: string, to: Destination) {
    await tapped(await hydrated(to.link));
    await settled(step, to);
  }

  /** Taps `first`, then `second` after `gap` ms (while the first is pending, if it still shows); checks the last one followed rendered. */
  async function double(step: string, first: Destination, second: Destination, gap: number) {
    await tapped(await hydrated(first.link));
    if (gap) await page.waitForTimeout(gap);
    let last = first;
    try {
      await tapped(second.link, 500);
      last = second;
    } catch {
      // The first navigation already replaced the page: the second link has gone.
    }
    await settled(`${step} (${gap} ms)`, last);
  }

  async function report(label: string) {
    const result = { taps: stats.taps, tapsDuringPrefetch: stats.tapsDuringPrefetch, prefetches: stats.prefetches, failures: stats.failures.length, details: stats.failures };
    console.log(`PREFETCH STRESS ${label} ${JSON.stringify({ ...result, details: undefined })}`);
    if (process.env.PERF_OUT) writeFileSync(`${process.env.PERF_OUT}.${label}.json`, JSON.stringify(result, null, 2));
    await context.close();
    expect(stats.failures).toEqual([]);
  }

  const progress = (every = 25) => {
    if (stats.taps % every < 2) console.log(`taps ${stats.taps}, during a held prefetch ${stats.tapsDuringPrefetch}, prefetch requests ${stats.prefetches}, failures ${stats.failures.length}`);
  };

  return { page, heading, stats, tabs, single, double, report, progress };
}

test("prefetch stress 1, single taps: every tap ends on its destination", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  const { email, name, cycleId } = await seed();
  const { page, heading, stats, tabs, single, report, progress } = await stressPage(browser, email);
  const next = random(98_684);
  const all = Object.entries(tabs);

  while (stats.taps < TAPS) {
    // A fresh load now and then: every tab link's prefetch starts again (and is held).
    if (next() < 0.25) {
      await page.reload();
      await expect(heading).not.toBeEmpty();
    }
    const [label, to] = all[Math.floor(next() * all.length)];
    await single(`tab ${label}`, to);
    // A link that has just mounted, tapped at once (its prefetch starts on mount).
    if (label === "Cycles")
      await single("cycle card", { link: page.getByTestId("cycle-card").filter({ hasText: name }), url: `${APP_ORIGIN}/app/cycles/${cycleId}`, h1: name });
    else if (label === "Library") await single("peptide", { link: page.getByTestId("library-peptide").first(), url: /\/app\/library\/peptides\//, h1: /\S/ });
    else if (label === "Today")
      await single("calculator", {
        link: page.getByTestId("today-hero").getByRole("link", { name: "Set one up in the calculator" }),
        url: /\/app\/calculator\?plan=/,
        h1: "Calculator",
      });
    progress();
  }
  await report("single");
});

test("prefetch stress 2, double taps: the last link followed renders, most without a loading.tsx", async ({ browser }) => {
  test.setTimeout(60 * 60_000);
  const { email } = await seed();
  const { page, heading, stats, tabs, single, double, report, progress } = await stressPage(browser, email);
  const next = random(16_307);
  const all = Object.values(tabs);
  const disclaimer = { link: page.getByTestId("me-disclaimer"), url: `${APP_ORIGIN}/app/me/disclaimer`, h1: "Research terms" };
  const reminders = { link: page.getByTestId("me-reminders"), url: `${APP_ORIGIN}/app/notifications`, h1: /^Reminders on (your|this) phone$/ };
  const calculator = {
    link: page.getByTestId("today-hero").getByRole("link", { name: "Set one up in the calculator" }),
    url: /\/app\/calculator\?plan=/,
    h1: "Calculator",
  };
  const gap = () => [0, 30, 80, 150, 250][Math.floor(next() * 5)];

  while (stats.taps < TAPS) {
    if (next() < 0.3) {
      await page.reload();
      await expect(heading).not.toBeEmpty();
    }
    const kind = Math.floor(next() * 4);
    if (kind === 0) {
      // Me's two rows to pages without a loading.tsx, one after the other.
      await single("tab Me", tabs.Me);
      await double("disclaimer → reminders", disclaimer, reminders, gap());
    } else if (kind === 1) {
      await single("tab Me", tabs.Me);
      await double("reminders → disclaimer", reminders, disclaimer, gap());
    } else if (kind === 2) {
      // Today's calculator link (no loading.tsx), then a tab.
      await single("tab Today", tabs.Today);
      const to = all[Math.floor(next() * all.length)];
      await double("calculator → tab", calculator, to, gap());
    } else {
      // Two tabs, the second while the first is pending.
      const first = all[Math.floor(next() * all.length)];
      const second = all[Math.floor(next() * all.length)];
      await double("tab → tab", first, second, gap());
    }
    progress(20);
  }
  await report("double");
});
