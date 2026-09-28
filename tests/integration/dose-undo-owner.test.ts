// V1 undo_dose, as the database owner (psql): entries are moved back in
// time to prove the 60-second window without waiting, and an entry is given
// no schedule_version_after, as every dose recorded before V1 has, to prove
// those are never undoable. The accounts are unique to this run (committed).
// Runs in the integration-exclusive project.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { type Client, createCycle, createPeptide, interval, plan, tag } from "../support/cycles";
import { confirmArgs, d, NOON, occurrenceOn } from "../support/doses";
import { ensureAccount, ok, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { psql, quote } from "../support/psql";

const people = {
  wren: { email: uniqueEmail("v1o-wren"), name: "Wren Window", role: "researcher" },
  grace: { email: uniqueEmail("v1o-grace"), name: "Grace Admin", role: "admin" },
} as const;
let wren: Client;
let peptide = "";

const undoState = (entryId: string) => sqlState(wren.rpc("undo_dose", { p_request_key: randomUUID(), p_entry_id: entryId }), "undo_dose");

beforeAll(async () => {
  await ensureAccount(people.wren);
  await ensureAccount(people.grace);
  wren = await signedInClient(people.wren.email);
  peptide = await createPeptide(await signedInClient(people.grace.email), `Window ${tag()}`);
});

describe("the undo window", () => {
  it("allows an undo up to 60 seconds after the entry, not after", async () => {
    const cycleId = await createCycle(wren, { timeZone: NOON, plans: [plan(peptide, [interval(d(-4), d(20), "0.4", 2, "08:00")])] });
    const recordAt = async (date: string) => {
      const o = await occurrenceOn(wren, cycleId, date);
      return (await ok(wren.rpc("confirm_dose", confirmArgs(o) as never), "confirm")) as unknown as { id: string };
    };
    const inside = await recordAt(d(-4));
    psql(`update public.dose_records set recorded_at = recorded_at - interval '50 seconds', actual_at = actual_at - interval '50 seconds' where id = ${quote(inside.id)};`);
    expect(await undoState(inside.id)).toBe("ok");

    const outside = await recordAt(d(-4));
    psql(`update public.dose_records set recorded_at = recorded_at - interval '61 seconds', actual_at = actual_at - interval '61 seconds' where id = ${quote(outside.id)};`);
    expect(await undoState(outside.id)).toBe("AP032");

    // A skip has the same window.
    const o = await occurrenceOn(wren, cycleId, d(-2));
    const skip = (await ok(
      wren.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: o.key, p_seen_scheduled_at: o.scheduledAt, p_seen_dose_mg: o.doseMg }),
      "skip",
    )) as unknown as { id: string };
    psql(`update public.dose_skips set recorded_at = recorded_at - interval '61 seconds' where id = ${quote(skip.id)};`);
    expect(await undoState(skip.id)).toBe("AP032");
    const left = psql(`select 'doses', count(*) from public.dose_records where cycle_id = ${quote(cycleId)};
      select 'skips', count(*) from public.dose_skips where cycle_id = ${quote(cycleId)};
      select 'voids', count(*) from public.dose_voids where cycle_id = ${quote(cycleId)};`);
    expect(left).toEqual({ doses: "1", skips: "1", voids: "1" });
  });

  it("never undoes a dose recorded before V1 (no schedule_version_after)", async () => {
    const cycleId = await createCycle(wren, { timeZone: NOON, plans: [plan(peptide, [interval(d(-2), d(20), "0.4", 2, "08:00")])] });
    const o = await occurrenceOn(wren, cycleId, d(0));
    const dose = (await ok(wren.rpc("confirm_dose", confirmArgs(o) as never), "confirm")) as unknown as { id: string };
    psql(`update public.dose_records set schedule_version_after = null where id = ${quote(dose.id)};`);
    expect(await undoState(dose.id)).toBe("AP033");
  });
});
