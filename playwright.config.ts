import { defineConfig, devices } from "@playwright/test";
import { appTestEnv } from "./tests/support/local-supabase";

// Browser journeys against a production build, with host routing on as in
// local development: private app on app.localhost:<port>, canonical public
// site on www.localhost:<port> (Chromium resolves *.localhost to loopback).
// Any other host, such as plain localhost:<port>, also serves the public site.
// Needs the local Supabase stack (npm run db:start): the app uses its keys and
// sends invitation email to its Mailpit inbox. Tests create uniquely named
// accounts and invitations per run, so no database reset is needed between runs.
const port = Number(process.env.E2E_PORT ?? 3100);

export const SERVER_ORIGIN = `http://localhost:${port}`;
export const PUBLIC_ORIGIN = `http://www.localhost:${port}`;
export const APP_ORIGIN = `http://app.localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // One `next start` process (a single Node thread) serves every worker, and
  // each page view also prefetches its visible links. Playwright's default,
  // half the CPU cores, gives 16 browsers on a 32-core machine: the server
  // queues, a client navigation then takes 3-6 s to commit, and assertions
  // with the default 5 s timeout fail at random. A fixed count keeps the
  // server responsive (and the suite equally reliable) on any machine.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: SERVER_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${port}`,
    url: `${SERVER_ORIGIN}/about`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...appTestEnv(),
      APP_HOST: `app.localhost:${port}`,
      PUBLIC_HOST: `www.localhost:${port}`,
      // Bank of Canada USD→CAD rates served by the local stub (src/lib/inventory/fx.ts),
      // never the real API: Wed Aug 26 and Fri Aug 28 (none for the weekend); Aug 19 is "down".
      BOC_FX_TEST_RATES: JSON.stringify({ "2026-08-26": "1.3876", "2026-08-28": "1.3888", "2026-08-19": "unavailable" }),
    },
  },
});
