// S9 cycle access against the real local Supabase (npm run db:start), through
// PostgREST as each signed-in person, exactly as the app reads and writes:
// another researcher's cycle is unreadable and unwritable; an admin without
// a grant reads nothing; a granted admin reads but never writes; revoking
// denies the next read; no one writes the tables directly; an unacknowledged
// account writes nothing; a researcher reads a peptide that is no longer
// offered only through their OWN cycles (and a template's peptide names
// through template_peptides()); and the library and template counts
// include cycles, for admins only, as numbers.
import { beforeAll, describe, expect, it } from "vitest";
import { getCycle, listCycles, plansArgument } from "@/lib/cycles/service";
import type { Database } from "@/lib/supabase/database.types";
import {
  type Client,
  createCycle,
  createPeptide,
  day,
  interval,
  plan,
  saveCycle,
  setAvailable,
  tag,
  weekdays,
} from "../support/cycles";
import { anonClient, ensureAccount, ok, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";
import { saveTemplateAs } from "../support/admin-writers";

const people = {
  alex: { email: uniqueEmail("s9-acc-alex"), name: "Alex Owner", role: "researcher" },
  blair: { email: uniqueEmail("s9-acc-blair"), name: "Blair Other", role: "researcher" },
  una: { email: uniqueEmail("s9-acc-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
  grace: { email: uniqueEmail("s9-acc-grace"), name: "Grace Granted", role: "admin" },
  noah: { email: uniqueEmail("s9-acc-noah"), name: "Noah Admin", role: "admin" },
} as const;
type Name = keyof typeof people;
const id = {} as Record<Name, string>;
const db = {} as Record<Name, Client>;
const peptide = { open: "", withdrawn: "", withdrawnName: "" };

const TABLES = ["cycles", "cycle_plans", "cycle_revisions", "cycle_revision_plans", "cycle_revision_phases"] as const;
type Table = (typeof TABLES)[number];

/** Rows of `table` for the cycle, as `who` reads them. */
async function rowsOf(who: Client, table: Table, cycleId: string) {
  const column = table === "cycles" ? "id" : table === "cycle_revision_phases" ? "owner_id" : "cycle_id";
  const value = table === "cycle_revision_phases" ? id.alex : cycleId;
  // Every table has owner_id; the column names differ only in the filter.
  return ok(who.from(table).select("owner_id").eq(column as "owner_id", value), `read ${table}`);
}

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    id[key] = await ensureAccount(spec);
    db[key] = await signedInClient(spec.email);
  }
  const t = tag();
  peptide.open = await createPeptide(db.grace, `Access open ${t}`);
  peptide.withdrawnName = `Access withdrawn ${t}`;
  peptide.withdrawn = await createPeptide(db.grace, peptide.withdrawnName);
});

const cyclePlans = () => [plan(peptide.open, [interval(day(1), day(20))]), plan(peptide.withdrawn, [weekdays(day(1), day(30))])];

describe("cycles are the owner's; grants read, never write", () => {
  it("isolates researchers and admins, lets a granted admin read only, and denies again on revoke", async () => {
    const cycleId = await createCycle(db.alex, { name: "Alex private", plans: cyclePlans() });
    for (const table of TABLES) expect(await rowsOf(db.alex, table, cycleId), `alex ${table}`).not.toHaveLength(0);
    const before = await getCycle(db.alex, cycleId);

    // Another researcher and a non-granted admin read nothing, table by table.
    for (const who of ["blair", "noah", "grace"] as const) {
      for (const table of TABLES) expect(await rowsOf(db[who], table, cycleId), `${who} ${table}`).toEqual([]);
      expect(await getCycle(db[who], cycleId), who).toBeNull();
      expect(await listCycles(db[who], id.alex), who).toEqual([]);
    }
    expect(await sqlState(anonClient().from("cycles").select("id").eq("id", cycleId), "anon")).toBe("42501");

    // Nobody edits it but its owner: another person's save returns nothing and changes nothing.
    const edit = { cycleId, version: 1, name: "Taken over", plans: cyclePlans() };
    expect(await ok(saveCycle(db.blair, edit), "blair edits")).toBeNull();
    expect(await ok(saveCycle(db.noah, edit), "noah edits")).toBeNull();

    // Sharing with the team lets every admin read the whole history, and only read it.
    await ok(db.alex.rpc("share_with_team"), "share");
    expect(await getCycle(db.grace, cycleId)).toEqual(before);
    expect((await listCycles(db.grace, id.alex)).map((c) => c.id)).toContain(cycleId);
    expect(await getCycle(db.noah, cycleId)).toEqual(before);
    expect(await getCycle(db.blair, cycleId)).toBeNull();
    expect(await ok(saveCycle(db.grace, edit), "admin edits a shared cycle")).toBeNull();
    expect(await getCycle(db.alex, cycleId)).toEqual(before);

    // Stopping denies every admin's very next read.
    await ok(db.alex.rpc("stop_sharing_with_team"), "stop sharing");
    expect(await getCycle(db.grace, cycleId)).toBeNull();
    expect(await getCycle(db.noah, cycleId)).toBeNull();
    for (const table of TABLES) expect(await rowsOf(db.grace, table, cycleId), `revoked ${table}`).toEqual([]);
  });

  it("an admin's own cycle is private too; nobody writes the tables directly; unacknowledged accounts write nothing", async () => {
    const graceCycle = await createCycle(db.grace, { name: "Grace's own research", plans: [plan(peptide.open, [interval(day(2), day(9))])] });
    expect(await getCycle(db.grace, graceCycle)).not.toBeNull();
    expect(await getCycle(db.alex, graceCycle)).toBeNull();
    expect(await getCycle(db.noah, graceCycle)).toBeNull();

    const row: Database["public"]["Tables"]["cycles"]["Insert"] = { owner_id: id.alex, name: "Direct", goal: "Direct" };
    expect(await sqlState(db.alex.from("cycles").insert(row), "direct insert")).toBe("42501");
    expect(await sqlState(db.alex.from("cycles").update({ name: "Direct" }).eq("id", graceCycle), "direct update")).toBe("42501");
    expect(await sqlState(db.alex.from("cycle_revisions").delete().eq("cycle_id", graceCycle), "direct delete")).toBe("42501");
    expect(await sqlState(db.una.rpc("save_cycle", { p_name: "Una", p_goal: "Goal", p_baseline: "", p_time_zone: "UTC", p_plans: [] }), "una")).toBe("42501");
    expect(
      await sqlState(anonClient().rpc("save_cycle", { p_name: "Anon", p_goal: "Goal", p_baseline: "", p_time_zone: "UTC", p_plans: [] }), "anon"),
    ).toBe("42501");
  });
});

describe("peptides no longer offered, and the admin counts", () => {
  it("stay readable to the researcher whose own cycle uses them, and to nobody else; new references are refused", async () => {
    const cycleId = await createCycle(db.alex, { name: "Uses a withdrawn peptide", plans: cyclePlans() });
    const readable = async (who: Client) =>
      (await ok(who.from("peptides").select("id").eq("id", peptide.withdrawn), "read peptide")).length === 1;
    expect(await readable(db.blair)).toBe(true);

    await setAvailable(db.grace, peptide.withdrawn, peptide.withdrawnName, false);
    try {
      expect(await readable(db.alex)).toBe(true);
      expect(await readable(db.blair)).toBe(false);
      // Grace holds no grant now, and a grant would not widen the library either.
      expect(await readable(db.grace)).toBe(false);
      expect(await readable(db.una)).toBe(false);
      expect(await sqlState(anonClient().from("peptides").select("id").eq("id", peptide.withdrawn), "anon")).toBe("42501");

      // The existing plan keeps its peptide through an edit (nothing has started yet)...
      const [revision] = (await getCycle(db.alex, cycleId))!.revisions;
      const current = plansArgument(revision.plans.map((p) => ({ ...p, effectiveFrom: day(0) }))) as { phases: { dose_mg?: string }[] }[];
      current[1].phases[0].dose_mg = "0.5";
      expect(await ok(saveCycle(db.alex, { cycleId, version: 1, plans: current }), "edit")).toBe(cycleId);
      const edited = (await getCycle(db.alex, cycleId))!;
      expect(edited.currentRevision).toBe(2);
      expect(edited.revisions[1].plans[1]).toMatchObject({ peptideId: peptide.withdrawn, phases: [{ doseMg: "0.5" }] });

      // ...but no new cycle or new plan may add it.
      expect(await sqlState(saveCycle(db.alex, { plans: [plan(peptide.withdrawn, [interval(day(1), day(5))])] }), "new cycle")).toBe("AP007");
      const other = await createCycle(db.alex, { plans: [plan(peptide.open, [interval(day(3), day(8))])] });
      const [otherRevision] = (await getCycle(db.alex, other))!.revisions;
      const withNew = [
        ...(plansArgument(otherRevision.plans.map((p) => ({ ...p, effectiveFrom: day(0) }))) as unknown[]),
        plan(peptide.withdrawn, [interval(day(3), day(8))], null, day(0)),
      ];
      expect(await sqlState(saveCycle(db.alex, { cycleId: other, version: 1, plans: withNew }), "new plan")).toBe("AP007");
    } finally {
      await setAvailable(db.grace, peptide.withdrawn, peptide.withdrawnName, true);
    }
  });

  it("a template naming a peptide no longer offered can be copied with it; only its names are readable (Marco, 2026-09-26)", async () => {
    const name = `Template only ${tag()}`;
    const only = await createPeptide(db.grace, name);
    const templateId = (await ok(
      saveTemplateAs(db.grace, {
        p_name: `Needs ${name}`,
        p_guidance: "",
        p_plans: [
          { peptide_id: only, phases: [{ kind: "active", offset_days: 0, length_days: 5, dose_mg: "1", local_time: "08:00", schedule_type: "interval", every_days: 1 }] },
          { peptide_id: peptide.open, phases: [{ kind: "active", offset_days: 0, length_days: 5, dose_mg: "1", local_time: "08:00", schedule_type: "interval", every_days: 1 }] },
        ],
      }),
      "template",
    ))!;
    const other = (await ok(
      saveTemplateAs(db.grace, {
        p_name: `Other ${name}`,
        p_guidance: "",
        p_plans: [{ peptide_id: peptide.open, phases: [{ kind: "active", offset_days: 0, length_days: 5, dose_mg: "1", local_time: "08:00", schedule_type: "interval", every_days: 1 }] }],
      }),
      "other template",
    ))!;
    await setAvailable(db.grace, only, name, false);

    // The template's peptides, withdrawn one included, for acknowledged readers only.
    const named = await ok(db.blair.rpc("template_peptides", { p_template_id: templateId }), "template peptides");
    expect(named.find((p) => p.id === only)).toEqual({ id: only, name, available: false });
    expect(named.map((p) => p.id).sort()).toEqual([only, peptide.open].sort());
    expect((await ok(db.blair.rpc("template_peptides", { p_template_id: other }), "other")).map((p) => p.id)).toEqual([peptide.open]);
    expect(await sqlState(db.una.rpc("template_peptides", { p_template_id: templateId }), "unacknowledged")).toBe("42501");
    expect(await sqlState(anonClient().rpc("template_peptides", { p_template_id: templateId }), "anon")).toBe("42501");
    // The library itself still hides it.
    expect(await ok(db.blair.from("peptides").select("id").eq("id", only), "library")).toEqual([]);

    // Copying the template keeps it; a custom cycle, another template's copy, or a later new plan can't add it.
    const withdrawnPlan = plan(only, [interval(day(1), day(5), "1", 1)]);
    const copy = { plans: [withdrawnPlan, plan(peptide.open, [interval(day(1), day(5))])], templateId };
    const cycleId = (await ok(saveCycle(db.blair, copy), "template copy"))!;
    expect((await getCycle(db.blair, cycleId))!.revisions[0].plans.map((p) => p.peptideId)).toEqual([only, peptide.open]);
    expect(await sqlState(saveCycle(db.blair, { plans: [withdrawnPlan] }), "custom")).toBe("AP007");
    expect(await sqlState(saveCycle(db.blair, { plans: [withdrawnPlan], templateId: other }), "another template")).toBe("AP007");
    const plain = await createCycle(db.blair, { plans: [plan(peptide.open, [interval(day(3), day(8))])] });
    const [plainRevision] = (await getCycle(db.blair, plain))!.revisions;
    const withNew = [
      ...(plansArgument(plainRevision.plans.map((p) => ({ ...p, effectiveFrom: day(0) }))) as unknown[]),
      plan(only, [interval(day(3), day(8))], null, day(0)),
    ];
    expect(await sqlState(saveCycle(db.blair, { cycleId: plain, version: 1, plans: withNew }), "new plan")).toBe("AP007");
  });

  it("count cycles in the library's 'referenced by' and the template usage, for admins only", async () => {
    const t = tag();
    const counted = await createPeptide(db.grace, `Counted ${t}`);
    const counts = async () => (await ok(db.grace.rpc("library_reference_counts").eq("peptide_id", counted), "counts"))[0];
    expect(await counts()).toMatchObject({ template_count: 0, cycle_count: 0 });
    await createCycle(db.alex, { plans: [plan(counted, [interval(day(1), day(5))])] });
    await createCycle(db.blair, { plans: [plan(counted, [interval(day(1), day(5))])] });
    await createCycle(db.grace, { plans: [plan(counted, [interval(day(1), day(5))])] });
    expect(await counts()).toMatchObject({ template_count: 0, cycle_count: 3 });
    expect(await sqlState(db.alex.rpc("library_reference_counts"), "researcher")).toBe("42501");
    expect(await sqlState(anonClient().rpc("library_reference_counts"), "anon")).toBe("42501");
  });
});
