// R15's server rule, tested directly: the acknowledgement action records the
// research terms only when `accepted` is exactly true. The screen keeps
// "Agree and continue" disabled until the box is ticked, so a browser never
// sends anything else; this proves the server still refuses it. Joining, it
// goes on to the install step; someone agreeing again to changed terms goes
// back to Today. The action runs against the real local Supabase as the
// signed-in person; only the request's cookie session is swapped for a
// signed-in client.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ACKNOWLEDGEMENT_VERSION, AFTER_ACKNOWLEDGEMENT_PATH, RESEARCH_HOME } from "@/lib/auth/paths";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));

const { acknowledge } = await import("@/app/(private)/auth/actions");

const REFUSED = { error: "Tick the acknowledgement to continue. It is required for researcher accounts." };
const newcomer = { email: uniqueEmail("v4-ack-newcomer"), name: "V4 Unacknowledged Researcher" };
const returning = { email: uniqueEmail("terms-ack-returning"), name: "Terms Returning Researcher" };
let newcomerId: string;
let returningId: string;

beforeAll(async () => {
  newcomerId = await ensureAccount({ ...newcomer, role: "researcher", acknowledged: false });
  returningId = await ensureAccount({ ...returning, role: "researcher", termsVersion: "2026-09-placeholder" });
});

const stored = async (id = newcomerId) =>
  (await serviceClient().from("profiles").select("acknowledged_at, acknowledgement_version").eq("id", id).single()).data;

describe("the acknowledgement action", () => {
  it("refuses anything but accepted === true and records nothing", async () => {
    acting.client = await signedInClient(newcomer.email);
    for (const accepted of [false, undefined, null, "true", "on", 1, {}, [true]]) {
      expect(await acknowledge({ accepted })).toEqual(REFUSED);
    }
    expect(await stored()).toEqual({ acknowledged_at: null, acknowledgement_version: null });
  });

  it("records it with the version and time for accepted === true, then goes on to the install step", async () => {
    acting.client = await signedInClient(newcomer.email);
    // The form navigates there (not a redirect: see goTo in the actions).
    expect(await acknowledge({ accepted: true })).toEqual({ redirectTo: AFTER_ACKNOWLEDGEMENT_PATH });
    const row = await stored();
    expect(row?.acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
    expect(row?.acknowledged_at).not.toBeNull();
  });

  it("records a new agreement over an earlier version's, then goes back to Today", async () => {
    acting.client = await signedInClient(returning.email);
    const before = await stored(returningId);
    expect(await acknowledge({ accepted: false })).toEqual(REFUSED);
    expect(await stored(returningId)).toEqual(before);
    expect(await acknowledge({ accepted: true })).toEqual({ redirectTo: RESEARCH_HOME });
    const row = await stored(returningId);
    expect(row?.acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
    expect(Date.parse(row!.acknowledged_at!)).toBeGreaterThan(Date.parse(before!.acknowledged_at!));
  });
});
