import type { Page, Route } from "@playwright/test";

type PathMatch = string | ((pathname: string) => boolean);
const matcher = (match: PathMatch) => (url: URL) => (typeof match === "string" ? url.pathname === match : match(url.pathname));

/** Sends a Server Action on to the app from Playwright's own process, which doesn't resolve *.localhost: to loopback, with the page's host. */
async function fetchAction(route: Route) {
  const request = route.request();
  const headers = await request.allHeaders();
  const url = new URL(request.url());
  const host = url.host;
  url.hostname = "127.0.0.1";
  return route.fetch({ url: url.toString(), headers: { ...headers, host } });
}

const isAction = async (route: Route) => route.request().method() === "POST" && Boolean((await route.request().allHeaders())["next-action"]);

/**
 * From now on, a Server Action on the page (`match`: its pathname, or a test
 * of it) is answered but its refreshed page never arrives, as over a
 * connection that stalls after the save. A Server Action that refreshes
 * answers with one Flight response carrying its result (row 0's "a") and
 * the refreshed page (row 0's "f"): the result is passed through as the
 * server sent it, the page is removed, and Next.js then asks for it with an
 * RSC request, which (like every later RSC request for a matching page, a
 * router refresh or navigation included) is held unanswered. An aborted
 * request would not do: Next.js falls back to a full page load. `actions`
 * counts the actions sent (a save goes once), `held` the page loads held.
 */
export async function stallRefresh(page: Page, match: PathMatch) {
  const counts = { actions: 0, held: 0 };
  await page.route(matcher(match), async (route) => {
    if (await isAction(route)) {
      counts.actions += 1;
      const response = await fetchAction(route);
      const rows = (await response.body()).toString("utf8").split("\n");
      const body = rows.map((row) => (row.startsWith("0:") ? `0:${JSON.stringify({ ...JSON.parse(row.slice(2)), f: "" })}` : row)).join("\n");
      await route.fulfill({ response, body });
      return;
    }
    if ((await route.request().allHeaders())["rsc"]) {
      counts.held += 1;
      return;
    }
    await route.fallback();
  });
  return counts;
}

/**
 * The next Server Action on the page reaches the app (the save is made), but
 * its answer is lost on the way back (the connection drops): the page sees a
 * failed request. Later actions go through. `actions` counts the actions sent.
 */
export async function loseAnswer(page: Page, match: PathMatch) {
  const counts = { actions: 0 };
  await page.route(matcher(match), async (route) => {
    if (!(await isAction(route))) return route.fallback();
    counts.actions += 1;
    if (counts.actions > 1) return route.fallback();
    await fetchAction(route);
    await route.abort("connectionreset");
  });
  return counts;
}

/**
 * The next Server Action on the page reaches the app (the save is made), but
 * its answer reaches the page only on release(): a save still in flight
 * while the person moves on. `actions` counts the actions sent.
 */
export async function holdAction(page: Page, match: PathMatch) {
  const counts = { actions: 0 };
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(matcher(match), async (route) => {
    if (!(await isAction(route))) return route.fallback();
    counts.actions += 1;
    const response = await fetchAction(route);
    await released;
    await route.fulfill({ response });
  });
  return { counts, release };
}
