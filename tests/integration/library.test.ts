// S4 peptide library (A2) against the real local Supabase (npm run db:start):
// admin-only writes enforced in the database, researchers (and admins on the
// research side) read available entries only, reference counts, and the
// admin-only server action. No mocked database: the action runs as the
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

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...newResearcher, role: "researcher", acknowledged: false });
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

describe("researchers read available entries only and cannot write", () => {
  it("a researcher reads available entries only; unacknowledged and anonymous callers read none", async () => {
    const adminClient = await signedInClient(admin.email);
    const [on, off] = [await create(adminClient, `Offered ${tag()}`), await create(adminClient, `Withdrawn ${tag()}`, false)];
    const ids = [on, off];

    const reader = await signedInClient(researcher.email);
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: on }]);
    const { data: all } = await reader.from("peptides").select("available");
    expect(all!.length).toBeGreaterThan(0);
    expect(all!.every((row) => row.available)).toBe(true);
    // The admin maintains every entry, available or not.
    expect((await adminClient.from("peptides").select("id").in("id", ids).order("created_at")).data).toEqual([
      { id: on },
      { id: off },
    ]);

    const unacknowledged = await signedInClient(newResearcher.email);
    expect((await unacknowledged.from("peptides").select("id").in("id", ids)).data).toEqual([]);
    expect((await anonClient().from("peptides").select("id").in("id", ids)).data ?? []).toEqual([]);

    // Withdrawing an entry hides it from researchers at once; offering it again shows it.
    await adminClient.rpc("save_library_peptide", { ...entry((await stored(on)).name, false), p_id: on });
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([]);
    await adminClient.rpc("save_library_peptide", { ...entry((await stored(off)).name, true), p_id: off });
    expect((await reader.from("peptides").select("id").in("id", ids)).data).toEqual([{ id: off }]);
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
