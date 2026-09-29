import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

// The "feel" measurement (tests/perf/feel.spec.ts): off the normal suite,
// run on purpose with
//   PERF=1 E2E_PORT=3261 npx playwright test -c tests/perf/playwright.config.ts
// against the same production build and local Supabase as the e2e suite
// (the webServer below builds and starts it unless one is already running on
// that port). One worker, so no measurement shares the server or the CPU with
// another. Results: stdout and PERF_OUT (JSON), when set.
export default defineConfig({
  ...base,
  testDir: ".",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 45 * 60_000,
  expect: { timeout: 30_000 },
  projects: [{ name: "chromium" }],
  // Build and start from the repository root, not this folder.
  webServer: base.webServer && !Array.isArray(base.webServer) ? { ...base.webServer, cwd: path.join(__dirname, "../..") } : base.webServer,
});
