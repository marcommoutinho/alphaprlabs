import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic (formatting, calculations, schedules) and
// integration tests against the real local Supabase (tests/integration; needs
// `npm run db:start`). Async Server Components and user journeys are covered
// by Playwright (tests/e2e).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server-only modules are imported directly by integration tests.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/local-supabase.ts"],
    testTimeout: 20_000,
  },
});
