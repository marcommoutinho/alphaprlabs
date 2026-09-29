// S4 / V7 peptide library (A2, A8 / A9 / D6) against the real local Supabase (npm run db:start):
// admin-only writes enforced in the database, table reads return available
// entries only for everyone (admins included), the admin-only maintenance
// list, reference counts, and the admin-only server action. No mocked database: the action runs as the
// signed-in person, only its cookie session is swapped for a signed-in client.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { anonClient, ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";
import { savePeptideAs } from "../support/admin-writers";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const { savePeptideAction } = await import("@/app/(private)/admin/library/actions");

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s4-lib-admin"), name: "S4 Library Admin" };
const researcher = { email: uniqueEmail("s4-lib-researcher"), name: "S4 Library Researcher" };
const newResearcher = { email: uniqueEmail("s4-lib-new"), name: "S4 Unacknowledged" };
const newAdmin = { email: uniqueEmail("s4-lib-new-admin"), name: "S4 Unacknowledged Admin" };
const second = { email: uniqueEmail("s4-lib-second"), name: "S4 Second Admin" };

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...newResearcher, role: "researcher", acknowledged: false });
  await ensureAccount({ ...newAdmin, role: "admin", acknowledged: false });
  await ensureAccount({ ...second, role: "admin" });
});

const tag = () => randomBytes(4).toString("hex");
const entry = (name: string, available = true) => ({
  p_name: name,
  p_information: `[Supplied information for ${name}]`,
  p_cycling_off_guidance: "",
  p_supplement_guidance: "",
  p_available: available,
});
const stored = async (id: string) =>
  (await serviceClient().from("peptides").select("*").eq("id", id).single()).data!;
const create = async (client: Client, name: string, available = true) => {
  const { data, error } = await savePeptideAs(client, entry(name, available));
  expect(error).toBeNull();
  return data!;
};

const peptideCount = async () => (await serviceClient().from("peptides").select("id", { count: "exact", head: true })).count!;

/** The list's row count is the number of library entries, between a count taken just before and one just after. */
async function expectOneRowPerEntry(list: () => PromiseLike<{ count: number | null; error: unknown }>) {
  const before = await peptideCount();
  const { count, error } = await list();
  const after = await peptideCount();
  expect(error).toBeNull();
  expect(count).toBeGreaterThanOrEqual(before);
  expect(count).toBeLessThanOrEqual(after);
}

describe("admins maintain the library in the database", () => {
  it("an admin creates and edits an entry; text is trimmed and updated moves only on a change", async () => {
    const client = await signedInClient(admin.email);
    const name = `Compound ${tag()}`;
    const { data: id } = await savePeptideAs(client, {
      ...entry(name),
      p_name: `  ${name} `,
      p_cycling_off_guidance: "  ",
      p_supplement_guidance: " Take with food. ",
    });
    expect(await stored(id!)).toMatchObject({
      name,
      information: `[Supplied information for ${name}]`,
      cycling_off_guidance: "",
      supplement_guidance: "Take with food.",
      available: true,
    });
    const first = await stored(id!);

    // Saving the same content changes nothing, not even "updated".
    expect((await savePeptideAs(client, { ...entry(name), p_supplement_guidance: "Take with food.", p_id: id! })).data).toBe(id);
    expect((await stored(id!)).updated_at).toBe(first.updated_at);

    // Turning availability off is an edit: the entry stays, "updated" moves.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await savePeptideAs(client, { ...entry(name, false), p_id: id! })).data).toBe(id);
    const off = await stored(id!);
    expect(off).toMatchObject({ available: false, supplement_guidance: "", created_at: first.created_at });
    expect(new Date(off.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());

    // Editing an entry that does not exist is refused (P0002) and creates nothing.
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await savePeptideAs(client, { ...entry(name), p_id: missing })).error?.code).toBe("P0002");
    expect((await serviceClient().from("peptides").select("id").eq("id", missing)).data).toEqual([]);
  });

  it("an incomplete entry cannot be stored, even by an admin calling the database directly", async () => {
    const client = await signedInClient(admin.email);
    const name = `Incomplete ${tag()}`;
    expect((await savePeptideAs(client, { ...entry(name), p_information: "   " })).error).not.toBeNull();
    expect((await savePeptideAs(client, { ...entry(""), p_name: " " })).error).not.toBeNull();
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([]);
    const id = await create(client, name);
    expect((await savePeptideAs(client, { ...entry(name), p_information: "", p_id: id })).error).not.toBeNull();
    expect((await stored(id)).information).toBe(`[Supplied information for ${name}]`);
  });

  it("whitespace of any kind (tab, newline, CRLF, NBSP, Unicode spaces) is empty, not content", async () => {
    const client = await signedInClient(admin.email);
    const name = `Blank ${tag()}`;
    const id = await create(client, name);
    for (const blank of ["\t", "\n", "\r\n", "\r", "\u00a0", " \u2003\u3000\ufeff\u000b "]) {
      const label = JSON.stringify(blank);
      expect((await savePeptideAs(client, { ...entry(name), p_information: blank })).error, label).not.toBeNull();
      expect((await savePeptideAs(client, { ...entry(`x`), p_name: blank })).error, label).not.toBeNull();
      expect((await savePeptideAs(client, { ...entry(name), p_information: blank, p_id: id })).error, label).not.toBeNull();
      expect((await savePeptideAs(client, { ...entry(name), p_name: blank, p_id: id })).error, label).not.toBeNull();
      // The table checks refuse it too, even for the secret key.
      expect((await serviceClient().from("peptides").insert({ name: blank, information: "x" })).error, label).not.toBeNull();
      expect((await serviceClient().from("peptides").insert({ name, information: blank })).error, label).not.toBeNull();
    }
    expect((await stored(id)).information).toBe(`[Supplied information for ${name}]`);
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([{ id }]);

    // Surrounding whitespace of every kind is trimmed from stored text.
    const { error } = await savePeptideAs(client, {
      ...entry(name),
      p_name: `\t${name}\u00a0\r\n`,
      p_supplement_guidance: "\n\u3000",
      p_id: id,
    });
    expect(error).toBeNull();
    expect(await stored(id)).toMatchObject({ name, supplement_guidance: "" });
  });

  it("names are unique ignoring case and whitespace; an entry keeps or re-cases its own name", async () => {
    const client = await signedInClient(admin.email);
    const duplicate = (result: { error: { code?: string } | null }) => expect(result.error?.code).toBe("23505");

    // The literal pair. The library is shared by every run, so 'BPC-157' may
    // already exist from an earlier run; either way ' bpc-157 ' is refused.
    const literal = await savePeptideAs(client, entry("BPC-157"));
    if (literal.error) duplicate(literal);
    duplicate(await savePeptideAs(client, entry(" bpc-157 ")));
    expect((await serviceClient().from("peptides").select("id").ilike("name", "bpc-157")).data).toHaveLength(1);

    const t = tag();
    const id = await create(client, `Unique ${t}`, false);
    for (const variant of [`unique ${t}`, ` UNIQUE ${t.toUpperCase()}\t`, `Unique\u00a0 ${t}`, `\nunique\t\t${t}\r\n`]) {
      duplicate(await savePeptideAs(client, entry(variant)));
      // The table itself refuses it too, even for the secret key.
      expect((await serviceClient().from("peptides").insert({ name: variant.trim(), information: "x" })).error?.code).toBe("23505");
    }
    // Editing another entry to that name is refused and changes nothing.
    const other = await create(client, `Other ${t}`);
    duplicate(await savePeptideAs(client, { ...entry(`UNIQUE ${t}`), p_id: other }));
    expect((await stored(other)).name).toBe(`Other ${t}`);

    // The entry keeps its own name, and may change its case or spacing.
    expect((await savePeptideAs(client, { ...entry(`Unique ${t}`, false), p_id: id })).data).toBe(id);
    expect((await savePeptideAs(client, { ...entry(`UNIQUE  ${t}`), p_id: id })).data).toBe(id);
    expect(await stored(id)).toMatchObject({ name: `UNIQUE  ${t}`, available: true });
    expect((await serviceClient().from("peptides").select("id").ilike("name", `%${t}`)).data).toHaveLength(2);
  });

  it("reference counts are admin-only, one row per entry, 0 until templates and cycles exist", async () => {
    const client = await signedInClient(admin.email);
    const id = await create(client, `Counted ${tag()}`, false);
    const { data, error } = await client.rpc("library_reference_counts").eq("peptide_id", id);
    expect(error).toBeNull();
    expect(data).toEqual([{ peptide_id: id, template_count: 0, cycle_count: 0 }]);
    // One row per entry, counted (the shared local library outgrows the API's
    // 1,000-row cap); other test files add entries meanwhile.
    await expectOneRowPerEntry(() => client.rpc("library_reference_counts", undefined, { count: "exact", head: true }));
    for (const other of [await signedInClient(researcher.email), anonClient()]) {
      expect((await other.rpc("library_reference_counts")).error).not.toBeNull();
    }
  });
});

describe("table reads return available entries only, for everyone; A2 lists all through an admin-only path", () => {
  it("a researcher reads available entries only; unacknowledged and anonymous callers read none", async () => {
    const adminClient = await signedInClient(admin.email);
    const [on, off] = [await create(adminClient, `Offered ${tag()}`), await create(adminClient, `Withdrawn ${tag()}`, false)];
    const ids = [on, off];

    const reader = await signedInClient(researcher.email);
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: on }]);
    const { data: all } = await reader.from("peptides").select("available");
    expect(all!.length).toBeGreaterThan(0);
    expect(all!.every((row) => row.available)).toBe(true);
    // An admin's own table reads (the research side) are no wider.
    expect((await adminClient.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: on }]);

    const unacknowledged = await signedInClient(newResearcher.email);
    expect((await unacknowledged.from("peptides").select("id").in("id", ids)).data).toEqual([]);
    // Anonymous callers have no privilege on the table at all.
    expect((await anonClient().from("peptides").select("id").in("id", ids)).error?.code).toBe("42501");

    // Withdrawing an entry hides it from researchers at once; offering it again shows it.
    await savePeptideAs(adminClient, { ...entry((await stored(on)).name, false), p_id: on });
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([]);
    await savePeptideAs(adminClient, { ...entry((await stored(off)).name, true), p_id: off });
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: off }]);
    expect((await adminClient.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: off }]);
  });

  it("admins list every entry, available or not, through admin_library_peptides(), even before acknowledging", async () => {
    const adminClient = await signedInClient(admin.email);
    const [on, off] = [await create(adminClient, `Listed ${tag()}`), await create(adminClient, `Listed off ${tag()}`, false)];
    const { data, error } = await adminClient
      .rpc("admin_library_peptides")
      .select("id, available")
      .in("id", [on, off])
      .order("id");
    expect(error).toBeNull();
    expect(data!.map((row) => [row.id, row.available])).toEqual(
      [
        [on, true],
        [off, false],
      ].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
    );
    await expectOneRowPerEntry(() => adminClient.rpc("admin_library_peptides", undefined, { count: "exact", head: true }));
    // ... while the admin's plain table read has only the available ones.
    const plain = await adminClient.from("peptides").select("id").in("id", [on, off]);
    expect(plain.data).toEqual([{ id: on }]);
    expect((await adminClient.from("peptides").select("id", { count: "exact", head: true }).eq("available", false)).count).toBe(0);

    // The back office does not need the acknowledgement; the research side does.
    const unacknowledgedAdmin = await signedInClient(newAdmin.email);
    const listed = await unacknowledgedAdmin.rpc("admin_library_peptides").in("id", [on, off]);
    expect(listed.error).toBeNull();
    expect(listed.data!.map((row) => row.id).sort()).toEqual([on, off].sort());
    expect((await unacknowledgedAdmin.from("peptides").select("id").in("id", [on, off])).data).toEqual([]);
    const saved = await savePeptideAs(unacknowledgedAdmin, { ...entry(`Unacknowledged admin ${tag()}`), p_available: false });
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual(expect.any(String));

    // Researchers (acknowledged or not) and anonymous callers cannot use it.
    for (const other of [await signedInClient(researcher.email), await signedInClient(newResearcher.email), anonClient()]) {
      const refused = await other.rpc("admin_library_peptides");
      expect(refused.error).not.toBeNull();
      expect(refused.data).toBeNull();
    }
  });

  it("researchers and anonymous callers cannot create, edit, withdraw or delete entries", async () => {
    const id = await create(await signedInClient(admin.email), `Guarded ${tag()}`);
    const before = await stored(id);
    for (const client of [await signedInClient(researcher.email), anonClient()]) {
      expect((await savePeptideAs(client, entry(`Forged ${tag()}`))).error).not.toBeNull();
      expect((await savePeptideAs(client, { ...entry("Forged"), p_id: id })).error).not.toBeNull();
      expect((await client.from("peptides").insert({ name: "Forged", information: "x" })).error).not.toBeNull();
      expect((await client.from("peptides").update({ available: false }).eq("id", id)).error).not.toBeNull();
      expect((await client.from("peptides").delete().eq("id", id)).error).not.toBeNull();
    }
    // Admins cannot bypass the function either: no direct writes for anyone.
    const adminClient = await signedInClient(admin.email);
    expect((await adminClient.from("peptides").update({ information: "" }).eq("id", id)).error).not.toBeNull();
    expect((await adminClient.from("peptides").delete().eq("id", id)).error).not.toBeNull();
    expect(await stored(id)).toEqual(before);
    expect((await serviceClient().from("peptides").select("id").like("name", "Forged%")).data).toEqual([]);
  });
});

describe("the A9 / D6 save action (server)", () => {
  const key = () => crypto.randomUUID();
  const blank = { id: null, version: null, shortDescription: "", strengths: [] as string[], information: "", cyclingOff: "", supplement: "", offered: true };

  it("an admin saves a draft, then publishes it; validation returns the designed messages", async () => {
    acting.client = await signedInClient(admin.email);
    const name = `Action ${tag()}`;
    expect(await savePeptideAction({ ...blank, name: " ", publish: false, requestKey: key() })).toMatchObject({ error: "Name is required.", problems: { name: "Name is required." } });
    expect(await savePeptideAction({ ...blank, name, publish: true, requestKey: key() })).toMatchObject({
      error: "Add a research summary to publish.",
      problems: { information: "Add a research summary to publish." },
    });
    // A request without a key is refused before anything is read.
    expect(await savePeptideAction({ ...blank, name, publish: false })).toEqual({ error: "This entry could not be identified. Reload the page and try again." });

    const draftKey = key();
    const draft = await savePeptideAction({ ...blank, name, strengths: ["10", "0.5"], publish: false, requestKey: draftKey });
    expect(draft).toMatchObject({ saved: { version: 1, published: false }, toast: `Draft saved · ${name}. Researchers can't see it.` });
    const id = draft.saved!.id;
    expect(await stored(id)).toMatchObject({ published_at: null, available: false, offered: true, vial_strengths_mg: [0.5, 10] });
    // A retry of the same request replays: no second entry.
    expect(await savePeptideAction({ ...blank, name, strengths: ["10", "0.5"], publish: false, requestKey: draftKey })).toMatchObject({ saved: { id, version: 1 } });
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([{ id }]);

    const published = await savePeptideAction({ ...blank, id, version: 1, name, information: "Supplied.", publish: true, requestKey: key() });
    expect(published).toMatchObject({ saved: { id, version: 2, published: true }, toast: `${name} published. Researchers can see it now.` });
    expect(await stored(id)).toMatchObject({ available: true, information: "Supplied." });

    // A name another entry has is refused, shown under the name field.
    expect(await savePeptideAction({ ...blank, name: ` ${name.toUpperCase()} `, publish: false, requestKey: key() })).toMatchObject({
      error: "A peptide with this name already exists.",
      problems: { name: "A peptide with this name already exists." },
    });
    // A malformed id is refused, never saved as a new (duplicate) entry.
    expect(await savePeptideAction({ ...blank, id: "not-a-uuid", version: 1, name: `${name} 2`, publish: false, requestKey: key() })).toMatchObject({
      error: "This entry could not be identified. Reload the page and try again.",
    });
    // Saving over an older version says who saved since (AP038), nothing written.
    expect(await savePeptideAction({ ...blank, id, version: 1, name, information: "Stale.", publish: true, requestKey: key() })).toEqual({
      changed: true,
      error: `Changed by ${admin.name} since you opened it. Nothing was saved.`,
    });
    expect(await stored(id)).toMatchObject({ information: "Supplied.", version: 2 });
  });

  // The database answers a replay and a stale version before any rule that depends on the entry now.
  it("a committed draft save with a blank summary, retried after another admin published the entry, replays", async () => {
    acting.client = await signedInClient(admin.email);
    const name = `Replay ${tag()}`;
    const id = (await savePeptideAction({ ...blank, name, publish: false, requestKey: key() })).saved!.id;
    const edit = { ...blank, id, version: 1, name, shortDescription: "Edited as a draft.", publish: false };
    const requestKey = key();
    // Committed; its answer never reached the editor.
    expect(await savePeptideAction({ ...edit, requestKey })).toMatchObject({ saved: { id, version: 2, published: false } });
    // Another admin publishes it with a summary.
    acting.client = await signedInClient(second.email);
    expect(await savePeptideAction({ ...edit, version: 2, information: "Supplied.", publish: true, requestKey: key() })).toMatchObject({
      saved: { id, version: 3, published: true },
      toast: `${name} published. Researchers can see it now.`,
    });
    // The retry of the first save, same key and details: its answer, nothing written.
    acting.client = await signedInClient(admin.email);
    expect(await savePeptideAction({ ...edit, requestKey })).toEqual({
      saved: { id, version: 2, published: false },
      toast: `Draft saved · ${name}. Researchers can't see it.`,
    });
    expect(await stored(id)).toMatchObject({ version: 3, information: "Supplied.", available: true, short_description: "Edited as a draft." });
  });

  it("a stale save that is also invalid now is refused as changed (AP038), not as invalid", async () => {
    acting.client = await signedInClient(admin.email);
    const name = `Stale ${tag()}`;
    const id = (await savePeptideAction({ ...blank, name, publish: false, requestKey: key() })).saved!.id;
    acting.client = await signedInClient(second.email);
    expect(await savePeptideAction({ ...blank, id, version: 1, name, information: "Supplied.", publish: true, requestKey: key() })).toMatchObject({ saved: { version: 2 } });
    // The first admin's editor, still at version 1 (a draft there), saves a draft without a summary.
    acting.client = await signedInClient(admin.email);
    expect(await savePeptideAction({ ...blank, id, version: 1, name, shortDescription: "Mine.", publish: false, requestKey: key() })).toEqual({
      changed: true,
      error: `Changed by ${second.name} since you opened it. Nothing was saved.`,
    });
    // At the current version, the published entry keeps its summary: refused for that, on the field.
    expect(await savePeptideAction({ ...blank, id, version: 2, name, shortDescription: "Mine.", publish: false, requestKey: key() })).toEqual({
      error: "Add a research summary to publish.",
      problems: { information: "Add a research summary to publish." },
    });
    expect(await stored(id)).toMatchObject({ version: 2, information: "Supplied.", short_description: "" });
  });

  it("a researcher calling the action is refused before anything is saved", async () => {
    acting.client = await signedInClient(researcher.email);
    const name = `Researcher action ${tag()}`;
    await expect(savePeptideAction({ ...blank, name, information: "Supplied.", publish: true, requestKey: key() })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([]);
  });
});
