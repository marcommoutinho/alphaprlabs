import { defineConfig, devices } from "@playwright/test";

// Browser journeys against a production build, with host routing on as in
// local development: private app on app.localhost:<port>, canonical public
// site on www.localhost:<port> (Chromium resolves *.localhost to loopback).
// Any other host, such as plain localhost:<port>, also serves the public site.
const port = Number(process.env.E2E_PORT ?? 3100);

export const SERVER_ORIGIN = `http://localhost:${port}`;
export const PUBLIC_ORIGIN = `http://www.localhost:${port}`;
export const APP_ORIGIN = `http://app.localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
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
      APP_HOST: `app.localhost:${port}`,
      PUBLIC_HOST: `www.localhost:${port}`,
    },
  },
});
