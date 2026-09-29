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
  // Owner-level psql moves undo_dose's entries back in time (committed, a unique account).
  "tests/integration/dose-undo-owner.test.ts",
  // Owner-level psql tries S14's composite keys (always rolled back).
  "tests/integration/supplies-keys.test.ts",
  // Owner-level psql transactions hold reopen_personal_vial's (and its rivals') locks.
  "tests/integration/supplies-locks.test.ts",
  // Owner-level psql writes a month of S15 check-ins (committed, a unique account) and tries the table's checks and day (rolled back).
  "tests/integration/progress-owner.test.ts",
  // Owner-level psql writes 1,105 recorded doses (committed, a unique account) to prove keyset paging.
  "tests/integration/dose-paging.test.ts",
  // Owner-level psql writes 1,100 S16 Taken records (committed, a unique account) and tries the tables' checks and occurrences (rolled back).
  "tests/integration/supplements-owner.test.ts",
  // Owner-level psql writes 1,050 cycles, mixtures and vials (committed, a unique account) to prove A8's keyset reads,
  // re-runs S17's data migration in a rolled-back transaction, and reads the function catalog.
  "tests/integration/support-owner.test.ts",
  // Owner-level psql re-applies the purchase currency migration on recorded CAD purchases (dropping and re-adding
  // business_purchases columns) and tries the table's conversion checks, always rolled back.
  "tests/integration/purchase-currency-owner.test.ts",
  // Owner-level psql re-applies the sellers migration on recorded sales and invitations (dropping and re-adding
  // business_sales and invitations columns) and tries the sale guard's one exception, always rolled back; it also
  // records 1,050 sales (committed, its own stock item) to prove the per-seller totals.
  "tests/integration/sellers-owner.test.ts",
  // Owner-level psql records 1,210 sales (committed, in a past year no other test uses) to prove V5's Business
  // aggregates, tries the stock guard's threshold exception, and re-applies the Business migration on recorded
  // stock (dropping and re-adding a business_stock_items column), always rolled back.
  "tests/integration/business-overview-owner.test.ts",
  // Read-only owner SQL through psql (the catalog: anon holds no public table privilege), plus one rolled-back table.
  "tests/integration/anon-privileges.test.ts",
  // Owner-level psql records 1,050 sales and 1,010 purchases (committed, in a past year no other test uses) to prove V6's
  // Ledger reads, sales late in the Toronto evening, and re-applies the records migration on recorded purchases (dropping
  // and re-adding a business_purchases column), always rolled back.
  "tests/integration/records-owner.test.ts",
];

/** How many shared integration files run at once (see the integration project). */
const INTEGRATION_WORKERS = 2;

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
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: EXCLUSIVE,
          // INTEGRATION_WORKERS files at once, after the unit files (a project with its own worker count needs
          // its own group). With a file per core (31 here), about one run in two lost a write to a gateway 502:
          // PostgREST closing a keep-alive connection with Kong's next request unread (tests/support/local-supabase.ts
          // gatewayFetch), mostly in the burst of sign-ins at the start. Fewer at once keeps the stack out of it.
          maxWorkers: INTEGRATION_WORKERS,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "integration-exclusive",
          include: EXCLUSIVE,
          fileParallelism: false,
          // After the unit and shared integration files have finished.
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
