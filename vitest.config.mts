import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic (formatting, calculations, schedules) and
// integration tests against the real local Supabase (tests/integration; needs
// `npm run db:start`). Async Server Components and user journeys are covered
// by Playwright (tests/e2e).
//
// Integration files that run SQL as the database owner in one long
// transaction (psql fixtures, always rolled back) run on their own, after
// everything else. Their DDL takes table locks the rest of the stack waits
// on: CREATE POLICY in the local Postgres image takes ACCESS EXCLUSIVE locks
// on every auth.* table (and storage/realtime ones) until the rollback, and
// the fixture's foreign key locks public.profiles against writes. Run beside
// other files, a sign-up or sign-in waiting on those locks deadlocks with the
// fixture and Auth answers 500 "Database error creating new user".
const EXCLUSIVE = [
  "tests/integration/support-grants-rls.test.ts",
  "tests/integration/inventory-access.test.ts",
  // Read-only owner SQL through psql (no fixture), kept apart all the same.
  "tests/integration/cycle-parity.test.ts",
  "tests/integration/dose-parity.test.ts",
  // An owner-level psql transaction holds save_mixture's locks while a confirmation waits.
  "tests/integration/dose-locks.test.ts",
  // Owner-level psql tries S14's composite keys (always rolled back).
  "tests/integration/supplies-keys.test.ts",
  // Owner-level psql transactions hold reopen_personal_vial's (and its rivals') locks.
  "tests/integration/supplies-locks.test.ts",
];

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
    globalSetup: ["tests/support/local-supabase.ts"],
    testTimeout: 20_000,
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: { name: "integration", include: ["tests/integration/**/*.test.ts"], exclude: EXCLUSIVE },
      },
      {
        extends: true,
        test: {
          name: "integration-exclusive",
          include: EXCLUSIVE,
          fileParallelism: false,
          // After the unit and shared integration files have finished.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
