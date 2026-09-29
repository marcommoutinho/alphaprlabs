// Stored Bank of Canada rates (Marco, 2026-09-27), against the real local
// Supabase: public.fx_rates and store_fx_rates() (secret key only, validated,
// first value per date kept), the save-time lookup asking the Valet API only
// when the table lacks the date's window, and the daily sync route's
// CRON_SECRET check. The Bank of Canada is the local test stub
// (BOC_FX_TEST_RATES) or an injected fetch: tests never call the real API.
import { randomInt } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, usdCadRate } from "@/lib/inventory/fx";
import { businessToday } from "@/lib/inventory/screens";
import { anonClient, ensureAccount, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

// Real published rates; the same values every test file stores.
const RATES = { "2026-09-24": "1.4100", "2026-09-25": "1.4145" };
process.env.BOC_FX_TEST_RATES = JSON.stringify(RATES);
const { GET } = await import("@/app/api/cron/fx-rates/route");

type Client = Awaited<ReturnType<typeof signedInClient>>;
const admin = { email: uniqueEmail("fx-admin"), name: "FX Admin" };
const researcher = { email: uniqueEmail("fx-researcher"), name: "FX Researcher" };
let adminDb: Client;
let researcherDb: Client;

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
  adminDb = await signedInClient(admin.email);
  researcherDb = await signedInClient(researcher.email);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/**
 * A date from 2000 to 2016 whose whole 10-day window holds no stored rate (the
 * table persists across runs), nor do the 10 days after it, so a lookup a few
 * days later (date + 3) sees only what the test stored, never a rate an
 * earlier run stored just after the date. Before the Valet series began
 * (2017-01-03), so an empty answer for it is "no rate", not a broken answer.
 */
async function emptyWindowDate(): Promise<string> {
  for (;;) {
    const date = addDays("2000-01-15", randomInt(0, 6100));
    const { count } = await serviceClient()
      .from("fx_rates")
      .select("rate_date", { count: "exact", head: true })
      .gte("rate_date", addDays(date, -10))
      .lte("rate_date", addDays(date, 10));
    if (count === 0) return date;
  }
}

const storedRate = async (date: string) =>
  (
    await serviceClient()
      .from("fx_rates")
      .select("usd_cad::text, source")
      .eq("rate_date", date)
      .overrideTypes<{ usd_cad: string; source: string }[], { merge: false }>()
  ).data![0] ?? null;

describe("store_fx_rates and public.fx_rates", () => {
  it("the secret key stores valid rates exactly as published; storing again changes nothing", async () => {
    const date = await emptyWindowDate();
    const rates = [{ date, rate: "1.3760" }];
    expect((await serviceClient().rpc("store_fx_rates", { p_rates: rates }).single()).data).toEqual({
      stored: 1,
      unchanged: 0,
      invalid: 0,
      conflicts: [],
    });
    expect(await storedRate(date)).toEqual({ usd_cad: "1.3760", source: "boc-valet" });
    expect((await serviceClient().rpc("store_fx_rates", { p_rates: rates }).single()).data).toMatchObject({ stored: 0, unchanged: 1 });
  });

  it("skips and counts invalid rows: bad dates, out of range, malformed rates", async () => {
    const date = await emptyWindowDate();
    const bad = [
      { date: "2001-02-30", rate: "1.3" },
      { date: "1999-12-31", rate: "1.3" },
      { date: "2101-01-01", rate: "1.3" },
      { date, rate: "0" },
      { date, rate: "0.000" },
      { date, rate: "100" },
      { date, rate: "-1.3" },
      { date, rate: "1.1234567" },
      { date, rate: "1,38" },
      { date, rate: "abc" },
      { date, rate: 1.38 },
      { date },
      "2001-01-01",
    ];
    const { data } = await serviceClient().rpc("store_fx_rates", { p_rates: bad }).single();
    expect(data).toEqual({ stored: 0, unchanged: 0, invalid: bad.length, conflicts: [] });
    expect(await storedRate(date)).toBeNull();
    expect(await sqlState(serviceClient().rpc("store_fx_rates", { p_rates: { date, rate: "1.3" } }))).toBe("22023");
  });

  it("a date already stored with a different rate keeps the first and reports the date", async () => {
    const date = await emptyWindowDate();
    await serviceClient().rpc("store_fx_rates", { p_rates: [{ date, rate: "1.2345" }] });
    const { data } = await serviceClient()
      .rpc("store_fx_rates", { p_rates: [{ date, rate: "1.2346" }, { date: addDays(date, -1), rate: "1.2300" }] })
      .single();
    expect(data).toEqual({ stored: 1, unchanged: 0, invalid: 0, conflicts: [date] });
    expect(await storedRate(date)).toMatchObject({ usd_cad: "1.2345" });
  });

  it("admins and anonymous callers can't write: not through the function, not directly; nobody changes a stored rate", async () => {
    const date = await emptyWindowDate();
    const rates = [{ date, rate: "1.3000" }];
    expect(await sqlState(adminDb.rpc("store_fx_rates", { p_rates: rates }))).toBe("42501");
    expect(await sqlState(researcherDb.rpc("store_fx_rates", { p_rates: rates }))).toBe("42501");
    expect(await sqlState(anonClient().rpc("store_fx_rates", { p_rates: rates }))).toBe("42501");
    expect(await sqlState(adminDb.from("fx_rates").insert({ rate_date: date, usd_cad: 1.3 }))).toBe("42501");
    expect(await sqlState(serviceClient().from("fx_rates").insert({ rate_date: date, usd_cad: 1.3 }))).toBe("42501");
    expect(await storedRate(date)).toBeNull();

    await serviceClient().rpc("store_fx_rates", { p_rates: rates });
    expect(await sqlState(adminDb.from("fx_rates").update({ usd_cad: 1.4 }).eq("rate_date", date))).toBe("42501");
    expect(await sqlState(serviceClient().from("fx_rates").update({ usd_cad: 1.4 }).eq("rate_date", date))).toBe("42501");
    expect(await sqlState(serviceClient().from("fx_rates").delete().eq("rate_date", date))).toBe("42501");
    expect(await storedRate(date)).toMatchObject({ usd_cad: "1.3000" });
  });

  it("admins read stored rates; researchers see none; anonymous callers are refused", async () => {
    const date = await emptyWindowDate();
    await serviceClient().rpc("store_fx_rates", { p_rates: [{ date, rate: "1.3100" }] });
    expect((await adminDb.from("fx_rates").select("rate_date").eq("rate_date", date)).data).toHaveLength(1);
    expect((await researcherDb.from("fx_rates").select("rate_date").eq("rate_date", date)).data).toEqual([]);
    expect(await sqlState(anonClient().from("fx_rates").select("rate_date"))).toBe("42501");
  });
});

describe("the save-time lookup against the table", () => {
  const answer = (rates: Record<string, string>) =>
    vi.fn<typeof globalThis.fetch>(async () => Response.json({ observations: Object.entries(rates).map(([d, v]) => ({ d, FXUSDCAD: { v } })) }));

  it("asks Valet only when the table lacks the window, stores the answer, then reads the table", async () => {
    const date = await emptyWindowDate();
    const earlier = addDays(date, -2);
    const fetch = answer({ [earlier]: "1.3500" });
    expect(await usdCadRate(date, { fetch })).toEqual({ ok: true, rate: "1.3500", rateDate: earlier });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await storedRate(earlier)).toMatchObject({ usd_cad: "1.3500" });
    // Stored now: Valet isn't asked again, and a different answer wouldn't count.
    const later = answer({ [earlier]: "9.9999" });
    expect(await usdCadRate(date, { fetch: later })).toEqual({ ok: true, rate: "1.3500", rateDate: earlier });
    expect(await usdCadRate(addDays(date, 3), { fetch: later })).toEqual({ ok: true, rate: "1.3500", rateDate: earlier });
    expect(later).not.toHaveBeenCalled();
  });

  it("an invalid 200 or an outage stores nothing and is 'unavailable'; an empty answer is 'no_rate'", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const date = await emptyWindowDate();
    const maintenance = vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 }));
    expect(await usdCadRate(date, { fetch: maintenance })).toEqual({ ok: false, reason: "unavailable" });
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await usdCadRate(date, { fetch: down })).toEqual({ ok: false, reason: "unavailable" });
    expect(await usdCadRate(date, { fetch: answer({}) })).toEqual({ ok: false, reason: "no_rate" });
    expect(await storedRate(date)).toBeNull();
  });
});

describe("the daily sync route (/api/cron/fx-rates)", () => {
  const call = (authorization?: string, query = "") =>
    GET(new Request(`http://localhost/api/cron/fx-rates${query}`, { headers: authorization ? { authorization } : {} }));
  const SECRET = "test-cron-secret-0123456789";

  it("refuses a missing or wrong secret, and every call when CRON_SECRET isn't set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect((await call(`Basic ${SECRET}`)).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
  });

  it("with the secret: stores the recent rates, and a second run changes nothing", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const first = await call(`Bearer ${SECRET}`, "?from=2026-09-20");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, from: "2026-09-20", fetched: 2, invalid: 0, conflicts: [] });
    expect(await storedRate("2026-09-25")).toMatchObject({ usd_cad: "1.4145" });
    expect(await storedRate("2026-09-24")).toMatchObject({ usd_cad: "1.4100" });
    const again = await call(`Bearer ${SECRET}`, "?from=2026-09-20");
    expect(await again.json()).toMatchObject({ ok: true, fetched: 2, stored: 0, unchanged: 2 });
  });

  it("a bad ?from= is 400, and an unreachable Bank of Canada is 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call(`Bearer ${SECRET}`, "?from=1999-01-01")).status).toBe(400);
    // Older history goes through scripts/fx-backfill.mjs: the route stops at 2025-01-01.
    expect((await call(`Bearer ${SECRET}`, "?from=2024-12-31")).status).toBe(400);
    expect((await call(`Bearer ${SECRET}`, "?from=soon")).status).toBe(400);
    vi.stubEnv("BOC_FX_TEST_RATES", JSON.stringify({ ...RATES, [businessToday()]: "unavailable" }));
    expect((await call(`Bearer ${SECRET}`, "?from=2026-09-20")).status).toBe(502);
    vi.stubEnv("BOC_FX_TEST_RATES", JSON.stringify({ ...RATES, [businessToday()]: "invalid" }));
    const invalid = await call(`Bearer ${SECRET}`, "?from=2026-09-20");
    expect(invalid.status).toBe(502);
    expect(await invalid.json()).toMatchObject({ ok: false, error: expect.stringContaining("Bank of Canada 2026-09-20..") });
  });
});
