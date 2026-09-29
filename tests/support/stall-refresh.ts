import type { Page } from "@playwright/test";

/**
 * From now on, a Server Action on `pathname` is answered but its refreshed
 * page never arrives, as over a connection that stalls after the save. A
 * Server Action that refreshes answers with one Flight response carrying
 * its result (row 0's "a") and the refreshed page (row 0's "f"): the result
 * is passed through as the server sent it, the page is removed, and Next.js
 * then asks for it with an RSC request, which (like every later RSC
 * request for the page, a router refresh included) is held unanswered. An
 * aborted request would not do: Next.js falls back to a full page load.
 * `actions` counts the actions sent (a save goes once), `held` the page
 * loads held.
 */
export async function stallRefresh(page: Page, pathname: string) {
  const counts = { actions: 0, held: 0 };
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const request = route.request();
      const headers = await request.allHeaders();
      if (request.method() === "POST" && headers["next-action"]) {
        counts.actions += 1;
        // Sent from Playwright's own process, which doesn't resolve *.localhost: to loopback, with the page's host.
        const url = new URL(request.url());
        const host = url.host;
        url.hostname = "127.0.0.1";
        const response = await route.fetch({ url: url.toString(), headers: { ...headers, host } });
        const rows = (await response.body()).toString("utf8").split("\n");
        const body = rows.map((row) => (row.startsWith("0:") ? `0:${JSON.stringify({ ...JSON.parse(row.slice(2)), f: "" })}` : row)).join("\n");
        await route.fulfill({ response, body });
        return;
      }
      if (headers["rsc"]) {
        counts.held += 1;
        return;
      }
      await route.fallback();
    },
  );
  return counts;
}
