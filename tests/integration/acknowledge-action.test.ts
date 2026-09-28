// R15's server rule, tested directly: the acknowledgement action records the
// researcher disclaimer only when `accepted` is exactly true. The screen
// keeps "Agree and continue" disabled until the box is ticked, so a browser
// never sends anything else; this proves the server still refuses it. The
// action runs against the real local Supabase as the signed-in person; only
// the request's cookie session is swapped for a signed-in client.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ACKNOWLEDGEMENT_VERSION, AFTER_ACKNOWLEDGEMENT_PATH } from "@/lib/auth/paths";
import { ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));

const { acknowledge } = await import("@/app/(private)/auth/actions");

const REFUSED = { error: "Tick the acknowledgement to continue. It is required for researcher accounts." };
const newcomer = { email: uniqueEmail("v4-ack-newcomer"), name: "V4 Unacknowledged Researcher" };
let newcomerId: string;

beforeAll(async () => {
  newcomerId = await ensureAccount({ ...newcomer, role: "researcher", acknowledged: false });
});

const stored = async () =>
  (await serviceClient().from("profiles").select("acknowledged_at, acknowledgement_version").eq("id", newcomerId).single()).data;

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
    await expect(acknowledge({ accepted: true })).rejects.toMatchObject({
      digest: expect.stringContaining(`;${AFTER_ACKNOWLEDGEMENT_PATH};`),
    });
    const row = await stored();
    expect(row?.acknowledgement_version).toBe(ACKNOWLEDGEMENT_VERSION);
    expect(row?.acknowledged_at).not.toBeNull();
  });
});
