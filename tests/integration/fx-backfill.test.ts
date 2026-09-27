// scripts/fx-backfill.mjs end to end against the real local Supabase: it runs
// as Main would run it (node, the secret key in the environment), with the
// Bank of Canada replaced by the local test stub (BOC_FX_TEST_RATES), and
// its exit code and stored rows are checked. Each test backfills its own
// week in 2017-2019 that nothing else stores.
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/inventory/valet.mjs";
import { localSupabase, serviceClient } from "../support/local-supabase";

/** Runs the script with `rates` as the stubbed Bank of Canada (and any other environment overrides). */
function backfill(args: string[], rates: Record<string, string>, env: Record<string, string> = {}) {
  const local = localSupabase();
  const run = spawnSync(process.execPath, ["scripts/fx-backfill.mjs", ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH,
      NEXT_PUBLIC_SUPABASE_URL: local.url,
      SUPABASE_SECRET_KEY: local.secretKey,
      BOC_FX_TEST_RATES: JSON.stringify(rates),
      ...env,
    },
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

/** A Monday-to-Sunday week from 2017 to 2019 with no stored rate. */
async function emptyWeek(): Promise<{ from: string; to: string; weekdays: string[] }> {
  for (;;) {
    const from = addDays("2017-01-09", 7 * randomInt(0, 150)); // Mondays
    const to = addDays(from, 6);
    const { count } = await serviceClient()
      .from("fx_rates")
      .select("rate_date", { count: "exact", head: true })
      .gte("rate_date", from)
      .lte("rate_date", to);
    if (count === 0) return { from, to, weekdays: [0, 1, 2, 3, 4].map((day) => addDays(from, day)) };
  }
}

const stored = async (from: string, to: string) =>
  Object.fromEntries(
    (
      await serviceClient()
        .from("fx_rates")
        .select("rate_date, usd_cad::text")
        .gte("rate_date", from)
        .lte("rate_date", to)
        .overrideTypes<{ rate_date: string; usd_cad: string }[], { merge: false }>()
    ).data!.map((row) => [row.rate_date, row.usd_cad]),
  );

const ratesFor = (weekdays: string[], rate = (i: number) => `1.32${i}0`) => Object.fromEntries(weekdays.map((date, i) => [date, rate(i)]));

describe("scripts/fx-backfill.mjs", () => {
  it("stores a validated range and exits 0; run again, nothing changes; a changed rate keeps the stored one and exits 2", async () => {
    const { from, to, weekdays } = await emptyWeek();
    const rates = ratesFor(weekdays);
    const first = backfill(["--from", from, "--to", to], rates);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain(`Done ${from}..${to}: 5 rates, 5 new, 0 already stored, 0 rejected.`);
    expect(await stored(from, to)).toEqual(rates);

    const again = backfill(["--from", from, "--to", to], rates);
    expect(again.code, again.err).toBe(0);
    expect(again.out).toContain("5 rates, 0 new, 5 already stored");

    const changed = backfill(["--from", from, "--to", to], { ...rates, [weekdays[2]]: "1.3999" });
    expect(changed.code).toBe(2);
    expect(changed.err).toContain(`kept the stored ones): ${weekdays[2]}`);
    expect(await stored(from, to)).toEqual(rates);
  });

  it("an invalid answer, an outage or an empty answer for past business days stores nothing and exits 1", async () => {
    const { from, to, weekdays } = await emptyWeek();
    const rates = ratesFor(weekdays);
    for (const [what, stub] of [
      ["a maintenance page", { ...rates, [to]: "invalid" }],
      ["an outage", { ...rates, [to]: "unavailable" }],
      ["no rates for a week of business days", {}],
    ] as const) {
      const run = backfill(["--from", from, "--to", to], stub);
      expect(run.code, what).toBe(1);
      expect(run.err, what).toContain("Nothing was stored");
    }
    expect(await stored(from, to)).toEqual({});
  });

  it("a range spanning several chunks fails whole when one chunk fails", async () => {
    const { from, weekdays } = await emptyWeek();
    // More than a year: two chunks. The second chunk's end answers a maintenance page.
    const to = addDays(from, 400);
    const run = backfill(["--from", from, "--to", to], { ...ratesFor(weekdays), [to]: "invalid" });
    expect(run.code).toBe(1);
    expect(run.err).toContain(`Bank of Canada ${addDays(from, 366)}..${to}`);
    expect(await stored(from, addDays(from, 6))).toEqual({});
  });

  it("bad arguments, a missing key, or the test stub outside the local stack exit 1 without asking anything", async () => {
    const week = await emptyWeek();
    for (const args of [[], ["--from", "2016-12-30"], ["--from", "2019-02-30"], ["--from", "2019-03-01", "--to", "2019-02-01"], ["--from", "2019-01-01", "--to", "2999-01-01"], ["--since", "2019-01-01"]]) {
      expect(backfill(args, {}).code, args.join(" ")).toBe(1);
    }
    expect(backfill(["--from", week.from, "--to", week.to], ratesFor(week.weekdays), { SUPABASE_SECRET_KEY: "" }).code).toBe(1);
    const remote = backfill(["--from", week.from, "--to", week.to], ratesFor(week.weekdays), { NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" });
    expect(remote.code).toBe(1);
    expect(remote.err).toContain("isn't the local stack");
    expect(await stored(week.from, week.to)).toEqual({});
  });
});
