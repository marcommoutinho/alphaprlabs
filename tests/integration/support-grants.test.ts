// S4 support grants and the reusable access rules against the real local
// Supabase (npm run db:start). Two researchers, a granted admin and a
// non-granted admin are isolated; granting gives read access, revoking takes
// it away at once, and the history keeps both. No mocked database.
import { beforeAll, describe, expect, it } from "vitest";
import { canReadResearcher } from "@/lib/support/access";
import { anonClient, ensureAccount, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

type Client = Awaited<ReturnType<typeof signedInClient>>;
type Person = { email: string; id: string; client: Client };

const people = {
  alex: { email: uniqueEmail("s4-grant-alex"), name: "Alex Researcher", role: "researcher" },
  blair: { email: uniqueEmail("s4-grant-blair"), name: "Blair Researcher", role: "researcher" },
  grace: { email: uniqueEmail("s4-grant-grace"), name: "Grace Admin", role: "admin" },
  noah: { email: uniqueEmail("s4-grant-noah"), name: "Noah Admin", role: "admin" },
  una: { email: uniqueEmail("s4-grant-una"), name: "Una Unacknowledged", role: "researcher", acknowledged: false },
} as const;
type Name = keyof typeof people;
const p = {} as Record<Name, Person>;

beforeAll(async () => {
  for (const [key, spec] of Object.entries(people) as [Name, (typeof people)[Name]][]) {
    const id = await ensureAccount(spec);
    p[key] = { email: spec.email, id, client: await signedInClient(spec.email) };
  }
});

const canRead = async (reader: Person, owner: Person) => {
  const { data, error } = await reader.client.rpc("can_read_researcher", { p_owner: owner.id });
  expect(error).toBeNull();
  // The server-side check gives the same answer as the database rule.
  expect(await canReadResearcher(reader.client, owner.id)).toBe(data);
  return data;
};
const canWrite = async (writer: Person, owner: Person) =>
  (await writer.client.rpc("can_write_researcher", { p_owner: owner.id })).data;
const grant = (from: Person, to: Person) => from.client.rpc("grant_support_access", { p_admin_id: to.id });
const revoke = (from: Person, to: Person) => from.client.rpc("revoke_support_access", { p_admin_id: to.id });
const visibleGrants = async (viewer: Person, researcher: Person) =>
  (
    await viewer.client
      .from("support_grants")
      .select("id, researcher_id, admin_id, granted_at, revoked_at")
      .eq("researcher_id", researcher.id)
      .order("granted_at")
  ).data ?? [];
const history = async (researcher: Person) =>
  (
    await serviceClient()
      .from("support_grants")
      .select("id, admin_id, granted_at, revoked_at")
      .eq("researcher_id", researcher.id)
      .order("granted_at")
  ).data!;

describe("without a grant, everyone is isolated", () => {
  it("each person reads and writes only their own records; the admin role alone reads nothing else", async () => {
    const everyone = Object.values(p).filter((person) => person !== p.una);
    for (const reader of everyone) {
      for (const owner of everyone) {
        expect(await canRead(reader, owner), `${reader.email} reads ${owner.email}`).toBe(reader === owner);
        expect(await canWrite(reader, owner), `${reader.email} writes ${owner.email}`).toBe(reader === owner);
      }
    }
    // Profiles stay own-row only for admins too.
    expect((await p.grace.client.from("profiles").select("id").in("id", [p.alex.id, p.blair.id])).data).toEqual([]);
    // Bad input and anonymous callers are denied.
    expect(await canReadResearcher(p.grace.client, "not-a-uuid")).toBe(false);
    expect((await anonClient().rpc("can_read_researcher", { p_owner: p.alex.id })).error).not.toBeNull();
    expect((await anonClient().rpc("grant_support_access", { p_admin_id: p.grace.id })).error).not.toBeNull();
    expect(await canReadResearcher(anonClient(), p.alex.id)).toBe(false);
  });

  it("an unacknowledged researcher reads their own records but cannot write them or grant access", async () => {
    expect(await canRead(p.una, p.una)).toBe(true);
    expect(await canWrite(p.una, p.una)).toBe(false);
    expect(await grant(p.una, p.grace)).toMatchObject({ error: null, data: null });
    expect(await history(p.una)).toEqual([]);
  });
});

describe("granting and revoking", () => {
  it("a grant gives only the named admin read-only access; revoking removes it at once; history keeps both", async () => {
    const { data: grantId, error } = await grant(p.alex, p.grace);
    expect(error).toBeNull();
    expect(grantId).toEqual(expect.any(String));
    // Granting again keeps the one active grant.
    expect((await grant(p.alex, p.grace)).data).toBe(grantId);

    expect(await canRead(p.grace, p.alex)).toBe(true);
    expect(await canWrite(p.grace, p.alex)).toBe(false);
    expect(await canRead(p.noah, p.alex)).toBe(false);
    expect(await canRead(p.blair, p.alex)).toBe(false);
    expect(await canRead(p.grace, p.blair)).toBe(false);
    expect(await canRead(p.alex, p.grace)).toBe(false);

    // Both parties see the grant; nobody else does.
    const [row] = await visibleGrants(p.alex, p.alex);
    expect(row).toMatchObject({ id: grantId, researcher_id: p.alex.id, admin_id: p.grace.id, revoked_at: null });
    expect(await visibleGrants(p.grace, p.alex)).toEqual([row]);
    expect(await visibleGrants(p.noah, p.alex)).toEqual([]);
    expect(await visibleGrants(p.blair, p.alex)).toEqual([]);

    // Revoke: denied from the next request, and the history keeps the grant.
    expect((await revoke(p.alex, p.grace)).data).toBe(true);
    expect(await canRead(p.grace, p.alex)).toBe(false);
    expect((await revoke(p.alex, p.grace)).data).toBe(false);
    const [revoked] = await history(p.alex);
    expect(revoked).toMatchObject({ id: grantId, admin_id: p.grace.id, granted_at: row.granted_at });
    expect(new Date(revoked.revoked_at!).getTime()).toBeGreaterThanOrEqual(new Date(row.granted_at).getTime());
    expect(await visibleGrants(p.grace, p.alex)).toEqual([{ ...row, revoked_at: revoked.revoked_at }]);

    // A new grant is a new history row; revoking it again leaves two revoked rows.
    const { data: secondId } = await grant(p.alex, p.grace);
    expect(secondId).not.toBe(grantId);
    expect(await canRead(p.grace, p.alex)).toBe(true);
    expect((await history(p.alex)).map((g) => [g.id, g.revoked_at === null])).toEqual([
      [grantId, false],
      [secondId, true],
    ]);
    expect((await revoke(p.alex, p.grace)).data).toBe(true);
    expect(await canRead(p.grace, p.alex)).toBe(false);
    expect((await history(p.alex)).every((g) => g.revoked_at !== null)).toBe(true);
  });

  it("only the researcher grants or revokes, only to an admin, and nobody edits the history directly", async () => {
    const { data: grantId } = await grant(p.blair, p.grace);
    expect(grantId).toEqual(expect.any(String));
    const before = await history(p.blair);

    // Another researcher or the admins cannot revoke Blair's grant: revoking
    // only ever touches the caller's own grants.
    expect((await revoke(p.alex, p.grace)).data).toBe(false);
    expect((await p.grace.client.rpc("revoke_support_access", { p_admin_id: p.grace.id })).data).toBe(false);
    expect((await revoke(p.noah, p.grace)).data).toBe(false);
    expect(await canRead(p.grace, p.blair)).toBe(true);

    // A grant can only name an admin other than oneself.
    expect((await grant(p.blair, p.alex)).data).toBeNull();
    expect((await grant(p.grace, p.grace)).data).toBeNull();
    expect(await canRead(p.alex, p.blair)).toBe(false);

    // No direct inserts, edits or deletes, for any role, even the secret key.
    for (const client of [p.blair.client, p.grace.client, p.noah.client, serviceClient()]) {
      const forged = await client.from("support_grants").insert({ researcher_id: p.blair.id, admin_id: p.noah.id });
      expect(forged.error).not.toBeNull();
      expect((await client.from("support_grants").update({ revoked_at: null }).eq("id", grantId!)).error).not.toBeNull();
      expect((await client.from("support_grants").delete().eq("id", grantId!)).error).not.toBeNull();
    }
    expect(await history(p.blair)).toEqual(before);
    expect(await canRead(p.noah, p.blair)).toBe(false);
    expect((await revoke(p.blair, p.grace)).data).toBe(true);
  });

  it("a grant works only while the grantee is an admin", async () => {
    await grant(p.alex, p.noah);
    expect(await canRead(p.noah, p.alex)).toBe(true);
    await serviceClient().from("profiles").update({ role: "researcher" }).eq("id", p.noah.id);
    try {
      expect(await canRead(p.noah, p.alex)).toBe(false);
      // ... and a researcher cannot be named in a new grant.
      expect((await grant(p.blair, p.noah)).data).toBeNull();
    } finally {
      await serviceClient().from("profiles").update({ role: "admin" }).eq("id", p.noah.id);
    }
    expect(await canRead(p.noah, p.alex)).toBe(true);
    expect((await revoke(p.alex, p.noah)).data).toBe(true);
    expect(await canRead(p.noah, p.alex)).toBe(false);
  });

  it("admins are researchers: an admin's own history is private until they grant another admin", async () => {
    expect(await canRead(p.noah, p.grace)).toBe(false);
    const { data } = await grant(p.grace, p.noah);
    expect(data).toEqual(expect.any(String));
    expect(await canRead(p.noah, p.grace)).toBe(true);
    expect(await canRead(p.alex, p.grace)).toBe(false);
    expect((await revoke(p.grace, p.noah)).data).toBe(true);
    expect(await canRead(p.noah, p.grace)).toBe(false);
  });
});
