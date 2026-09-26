// S4 peptide library (A2) against the real local Supabase (npm run db:start):
// admin-only writes enforced in the database, table reads return available
// entries only for everyone (admins included), the admin-only maintenance
// list, reference counts, and the admin-only server action. No mocked database: the action runs as the
// signed-in person, only its cookie session is swapped for a signed-in client.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { anonClient, ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const { saveLibraryEntryAction } = await import("@/app/(private)/admin/library/actions");

type Client = Awaited<ReturnType<typeof signedInClient>>;

const admin = { email: uniqueEmail("s4-lib-admin"), name: "S4 Library Admin" };
const researcher = { email: uniqueEmail("s4-lib-researcher"), name: "S4 Library Researcher" };
const newResearcher = { email: uniqueEmail("s4-lib-new"), name: "S4 Unacknowledged" };
const newAdmin = { email: uniqueEmail("s4-lib-new-admin"), name: "S4 Unacknowledged Admin" };

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...newResearcher, role: "researcher", acknowledged: false });
  await ensureAccount({ ...newAdmin, role: "admin", acknowledged: false });
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
  const { data, error } = await client.rpc("save_library_peptide", entry(name, available));
  expect(error).toBeNull();
  return data!;
};

describe("admins maintain the library in the database", () => {
  it("an admin creates and edits an entry; text is trimmed and updated moves only on a change", async () => {
    const client = await signedInClient(admin.email);
    const name = `Compound ${tag()}`;
    const { data: id } = await client.rpc("save_library_peptide", {
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
    expect((await client.rpc("save_library_peptide", { ...entry(name), p_supplement_guidance: "Take with food.", p_id: id! })).data).toBe(id);
    expect((await stored(id!)).updated_at).toBe(first.updated_at);

    // Turning availability off is an edit: the entry stays, "updated" moves.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await client.rpc("save_library_peptide", { ...entry(name, false), p_id: id! })).data).toBe(id);
    const off = await stored(id!);
    expect(off).toMatchObject({ available: false, supplement_guidance: "", created_at: first.created_at });
    expect(new Date(off.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());

    // Editing an entry that does not exist returns nothing and creates nothing.
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await client.rpc("save_library_peptide", { ...entry(name), p_id: missing })).data).toBeNull();
    expect((await serviceClient().from("peptides").select("id").eq("id", missing)).data).toEqual([]);
  });

  it("an incomplete entry cannot be stored, even by an admin calling the database directly", async () => {
    const client = await signedInClient(admin.email);
    const name = `Incomplete ${tag()}`;
    expect((await client.rpc("save_library_peptide", { ...entry(name), p_information: "   " })).error).not.toBeNull();
    expect((await client.rpc("save_library_peptide", { ...entry(""), p_name: " " })).error).not.toBeNull();
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([]);
    const id = await create(client, name);
    expect((await client.rpc("save_library_peptide", { ...entry(name), p_information: "", p_id: id })).error).not.toBeNull();
    expect((await stored(id)).information).toBe(`[Supplied information for ${name}]`);
  });

  it("whitespace of any kind (tab, newline, CRLF, NBSP, Unicode spaces) is empty, not content", async () => {
    const client = await signedInClient(admin.email);
    const name = `Blank ${tag()}`;
    const id = await create(client, name);
    for (const blank of ["\t", "\n", "\r\n", "\r", "\u00a0", " \u2003\u3000\ufeff\u000b "]) {
      const label = JSON.stringify(blank);
      expect((await client.rpc("save_library_peptide", { ...entry(name), p_information: blank })).error, label).not.toBeNull();
      expect((await client.rpc("save_library_peptide", { ...entry(`x`), p_name: blank })).error, label).not.toBeNull();
      expect((await client.rpc("save_library_peptide", { ...entry(name), p_information: blank, p_id: id })).error, label).not.toBeNull();
      expect((await client.rpc("save_library_peptide", { ...entry(name), p_name: blank, p_id: id })).error, label).not.toBeNull();
      // The table checks refuse it too, even for the secret key.
      expect((await serviceClient().from("peptides").insert({ name: blank, information: "x" })).error, label).not.toBeNull();
      expect((await serviceClient().from("peptides").insert({ name, information: blank })).error, label).not.toBeNull();
    }
    expect((await stored(id)).information).toBe(`[Supplied information for ${name}]`);
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([{ id }]);

    // Surrounding whitespace of every kind is trimmed from stored text.
    const { error } = await client.rpc("save_library_peptide", {
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
    const duplicate = (result: { error: { code: string } | null }) => expect(result.error?.code).toBe("23505");

    // The literal pair. The library is shared by every run, so 'BPC-157' may
    // already exist from an earlier run; either way ' bpc-157 ' is refused.
    const literal = await client.rpc("save_library_peptide", entry("BPC-157"));
    if (literal.error) duplicate(literal);
    duplicate(await client.rpc("save_library_peptide", entry(" bpc-157 ")));
    expect((await serviceClient().from("peptides").select("id").ilike("name", "bpc-157")).data).toHaveLength(1);

    const t = tag();
    const id = await create(client, `Unique ${t}`, false);
    for (const variant of [`unique ${t}`, ` UNIQUE ${t.toUpperCase()}\t`, `Unique\u00a0 ${t}`, `\nunique\t\t${t}\r\n`]) {
      duplicate(await client.rpc("save_library_peptide", entry(variant)));
      // The table itself refuses it too, even for the secret key.
      expect((await serviceClient().from("peptides").insert({ name: variant.trim(), information: "x" })).error?.code).toBe("23505");
    }
    // Editing another entry to that name is refused and changes nothing.
    const other = await create(client, `Other ${t}`);
    duplicate(await client.rpc("save_library_peptide", { ...entry(`UNIQUE ${t}`), p_id: other }));
    expect((await stored(other)).name).toBe(`Other ${t}`);

    // The entry keeps its own name, and may change its case or spacing.
    expect((await client.rpc("save_library_peptide", { ...entry(`Unique ${t}`, false), p_id: id })).data).toBe(id);
    expect((await client.rpc("save_library_peptide", { ...entry(`UNIQUE  ${t}`), p_id: id })).data).toBe(id);
    expect(await stored(id)).toMatchObject({ name: `UNIQUE  ${t}`, available: true });
    expect((await serviceClient().from("peptides").select("id").ilike("name", `%${t}`)).data).toHaveLength(2);
  });

  it("reference counts are admin-only, one row per entry, 0 until templates and cycles exist", async () => {
    const client = await signedInClient(admin.email);
    const id = await create(client, `Counted ${tag()}`, false);
    const { data, error } = await client.rpc("library_reference_counts");
    expect(error).toBeNull();
    expect(data!.find((row) => row.peptide_id === id)).toEqual({ peptide_id: id, template_count: 0, cycle_count: 0 });
    const { count } = await serviceClient().from("peptides").select("id", { count: "exact", head: true });
    expect(data).toHaveLength(count!);
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
    expect((await anonClient().from("peptides").select("id").in("id", ids)).data ?? []).toEqual([]);

    // Withdrawing an entry hides it from researchers at once; offering it again shows it.
    await adminClient.rpc("save_library_peptide", { ...entry((await stored(on)).name, false), p_id: on });
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([]);
    await adminClient.rpc("save_library_peptide", { ...entry((await stored(off)).name, true), p_id: off });
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: off }]);
    expect((await adminClient.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: off }]);
  });

  it("admins list every entry, available or not, through admin_library_peptides(), even before acknowledging", async () => {
    const adminClient = await signedInClient(admin.email);
    const [on, off] = [await create(adminClient, `Listed ${tag()}`), await create(adminClient, `Listed off ${tag()}`, false)];
    const { count } = await serviceClient().from("peptides").select("id", { count: "exact", head: true });
    const { count: availableCount } = await serviceClient()
      .from("peptides")
      .select("id", { count: "exact", head: true })
      .eq("available", true);

    const { data, error } = await adminClient.rpc("admin_library_peptides");
    expect(error).toBeNull();
    expect(data).toHaveLength(count!);
    expect(data!.filter((row) => [on, off].includes(row.id)).map((row) => [row.id, row.available])).toEqual([
      [on, true],
      [off, false],
    ]);
    // ... while the admin's plain table read has only the available ones.
    const { data: plain } = await adminClient.from("peptides").select("id, available");
    expect(plain).toHaveLength(availableCount!);
    expect(plain!.every((row) => row.available)).toBe(true);

    // The back office does not need the acknowledgement; the research side does.
    const unacknowledgedAdmin = await signedInClient(newAdmin.email);
    const listed = await unacknowledgedAdmin.rpc("admin_library_peptides").in("id", [on, off]);
    expect(listed.error).toBeNull();
    expect(listed.data!.map((row) => row.id).sort()).toEqual([on, off].sort());
    expect((await unacknowledgedAdmin.from("peptides").select("id").in("id", [on, off])).data).toEqual([]);
    const saved = await unacknowledgedAdmin.rpc("save_library_peptide", { ...entry(`Unacknowledged admin ${tag()}`), p_available: false });
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
      expect((await client.rpc("save_library_peptide", entry(`Forged ${tag()}`))).error).not.toBeNull();
      expect((await client.rpc("save_library_peptide", { ...entry("Forged"), p_id: id })).error).not.toBeNull();
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

describe("the A2 save action (server)", () => {
  it("an admin saves through the action; validation returns the designed messages", async () => {
    acting.client = await signedInClient(admin.email);
    const name = `Action ${tag()}`;
    const form = { id: null, name, information: "", cyclingOff: "", supplement: "", available: true };
    expect(await saveLibraryEntryAction({ ...form, name: " " })).toEqual({ error: "Name is required." });
    expect(await saveLibraryEntryAction(form)).toEqual({
      error: "Add the information researchers will see (incomplete entries can't be published).",
    });
    expect(await saveLibraryEntryAction({ ...form, information: "Supplied." })).toEqual({
      saved: true,
      toast: `Library updated · ${name}`,
      tone: "info",
    });
    const { data } = await serviceClient().from("peptides").select("id, available").eq("name", name);
    expect(data).toEqual([{ id: expect.any(String), available: true }]);
    expect(
      await saveLibraryEntryAction({ ...form, id: data![0].id, information: "Supplied.", available: false }),
    ).toMatchObject({ saved: true });
    expect(await stored(data![0].id)).toMatchObject({ available: false });

    // A name another entry has is refused, shown under the name field.
    expect(await saveLibraryEntryAction({ ...form, name: ` ${name.toUpperCase()} `, information: "Supplied." })).toEqual({
      error: "A peptide with this name already exists.",
      field: "name",
    });
    // A malformed id is refused, never saved as a new (duplicate) entry.
    expect(await saveLibraryEntryAction({ ...form, id: "not-a-uuid", information: "Supplied." })).toEqual({
      error: "This entry could not be identified. Reload the page and try again.",
    });
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([{ id: data![0].id }]);
  });

  it("a researcher calling the action is refused before anything is saved", async () => {
    acting.client = await signedInClient(researcher.email);
    const name = `Researcher action ${tag()}`;
    await expect(
      saveLibraryEntryAction({ name, information: "Supplied.", cyclingOff: "", supplement: "", available: true }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect((await serviceClient().from("peptides").select("id").eq("name", name)).data).toEqual([]);
  });
});
