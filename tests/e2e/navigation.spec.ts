// The private app's links don't prefetch (src/components/alpha/link.tsx):
// Next.js 16.2 can commit an empty page when a link is clicked while its
// prefetch is still in flight (vercel/next.js#98684). On a phone (tab bar)
// and a laptop (sidebar), against the production build: moving quickly
// between the tabs, a cycle card and its detail, Today's calculator link and
// a Library peptide, every destination renders its heading, and no request
// the app makes is a prefetch.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { ensureAccount, hydrated, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";
import { d, NOON } from "../support/noon";

async function seed(label: string) {
  const t = tag();
  const email = uniqueEmail(`nav-${label}`);
  await ensureAccount({ email, name: `Nav ${label}`, role: "researcher" });
  const peptide = `Nav BPC ${t}`;
  const { data, error } = await serviceClient()
    .from("peptides")
    .insert({ name: peptide, information: `[Supplied information for ${peptide}]`, available: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not seed ${peptide}: ${error?.message ?? "no row"}`);
  // Daily at 08:00 in a zone where it is about noon: a dose is due now, with no saved mix.
  const name = `Nav cycle ${t}`;
  const cycleId = await createCycle(await signedInClient(email), {
    name,
    timeZone: NOON,
    plans: [plan(data.id, [interval(d(-1), d(20), "0.25", 1, "08:00")])],
  });
  return { email, name, cycleId };
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** Clicks as soon as the link is interactive (when a prefetch would have started), then checks the destination rendered. */
async function follow(page: Page, link: Locator, url: RegExp | string, title: RegExp | string) {
  await (await hydrated(link)).click();
  await expect(page).toHaveURL(url);
  await expect(heading(page)).toHaveText(title);
}

for (const { device, viewport } of [
  { device: "phone", viewport: { width: 390, height: 844 } },
  { device: "laptop", viewport: { width: 1280, height: 820 } },
]) {
  test.describe(device, () => {
    test.use({ viewport });

    test("moving quickly between tabs and cycle pages always renders the destination, with no prefetch", async ({ page }) => {
      const { email, name, cycleId } = await seed(device);
      const prefetches: string[] = [];
      page.on("request", (request) => {
        if (request.headers()["next-router-prefetch"]) prefetches.push(request.url());
      });
      await signInAs(page, APP_ORIGIN, email);
      await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
      await expect(heading(page)).toHaveText("Today");

      // The tab bar on a phone, the sidebar on a laptop: the one shown ("Today 1": its count of due doses).
      const tab = (label: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: new RegExp(`^${label}( \\d+)?$`) });
      const detail = `${APP_ORIGIN}/app/cycles/${cycleId}`;
      for (let round = 0; round < 3; round += 1) {
        await follow(page, tab("Cycles"), `${APP_ORIGIN}/app/cycles`, "Cycles");
        await follow(page, page.getByTestId("cycle-card").filter({ hasText: name }), detail, name);
        await follow(page, tab("Today"), `${APP_ORIGIN}/app/today`, "Today");
        await follow(page, page.getByTestId("today-hero").getByRole("link", { name: "Set one up in the calculator" }), /\/app\/calculator\?plan=/, "Calculator");
        await follow(page, tab("Library"), `${APP_ORIGIN}/app/library`, "Library");
        const peptide = page.getByTestId("library-peptide").first();
        await (await hydrated(peptide)).click();
        await expect(page).toHaveURL(/\/app\/library\/peptides\//);
        await expect(heading(page)).not.toBeEmpty();
        await follow(page, tab("Progress"), `${APP_ORIGIN}/app/progress`, "Progress");
        await follow(page, tab("Cycles"), `${APP_ORIGIN}/app/cycles`, "Cycles");
        await follow(page, page.getByTestId("cycle-card").filter({ hasText: name }), detail, name);
        // Back and forward through the history the same way.
        await page.goBack();
        await expect(heading(page)).toHaveText("Cycles");
        await page.goForward();
        await expect(heading(page)).toHaveText(name);
        // The fifth tab: Me on a phone, Supplies in the sidebar.
        if (device === "phone") await follow(page, tab("Me"), `${APP_ORIGIN}/app/me`, `Nav ${device}`);
        else await follow(page, tab("Supplies"), `${APP_ORIGIN}/app/supplies`, "Personal supplies");
        await follow(page, tab("Today"), `${APP_ORIGIN}/app/today`, "Today");
      }
      expect(prefetches).toEqual([]);
    });
  });
}
