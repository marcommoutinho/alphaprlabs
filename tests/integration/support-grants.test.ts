// S4 support grants and the reusable access rules against the real local
// Supabase (npm run db:start). Two researchers, a granted admin and a
// non-granted admin are isolated; granting gives read access, revoking takes
// it away at once, and the history keeps both. No mocked database.
import { beforeAll, describe, expect, it } from "vitest";
import { canReadResearcher } from "@/lib/support/access";
import { anonClient, ensureAccount, ok, serviceClient, signedInClient, uniqueEmail } from "../support/local-supabase";

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
const canWrite = (writer: Person, owner: Person) =>
  ok(writer.client.rpc("can_write_researcher", { p_owner: owner.id }), "can_write_researcher");
// Grant and revoke must not fail: a refusal is a null grant id or `false`.
const grant = (from: Person, to: Person) =>
  ok(from.client.rpc("grant_support_access", { p_admin_id: to.id }), "grant_support_access");
const revoke = (from: Person, to: Person) =>
  ok(from.client.rpc("revoke_support_access", { p_admin_id: to.id }), "revoke_support_access");
const visibleGrants = (viewer: Person, researcher: Person) =>
  ok(
    viewer.client
      .from("support_grants")
      .select("id, researcher_id, admin_id, granted_at, revoked_at")
      .eq("researcher_id", researcher.id)
      .order("granted_at"),
    "support_grants read",
  );
const history = (researcher: Person) =>
  ok(
    serviceClient()
      .from("support_grants")
      .select("id, admin_id, granted_at, revoked_at")
      .eq("researcher_id", researcher.id)
      .order("granted_at"),
    "support_grants history",
  );
const setRole = (person: Person, role: "admin" | "researcher") =>
  ok(serviceClient().from("profiles").update({ role }).eq("id", person.id), "profile role update");

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
    expect(await ok(p.grace.client.from("profiles").select("id").in("id", [p.alex.id, p.blair.id]))).toEqual([]);
    // Bad input and anonymous callers are denied.
    expect(await canReadResearcher(p.grace.client, "not-a-uuid")).toBe(false);
    expect((await anonClient().rpc("can_read_researcher", { p_owner: p.alex.id })).error?.code).toBe("42501");
    expect((await anonClient().rpc("grant_support_access", { p_admin_id: p.grace.id })).error?.code).toBe("42501");
    expect(await canReadResearcher(anonClient(), p.alex.id)).toBe(false);
  });

  it("an unacknowledged researcher reads their own records but cannot write them or grant access", async () => {
    expect(await canRead(p.una, p.una)).toBe(true);
    expect(await canWrite(p.una, p.una)).toBe(false);
    expect(await grant(p.una, p.grace)).toBeNull();
    expect(await history(p.una)).toEqual([]);
  });
});

describe("granting and revoking", () => {
  it("a grant gives only the named admin read-only access; revoking removes it at once; history keeps both", async () => {
    const grantId = await grant(p.alex, p.grace);
    expect(grantId).toEqual(expect.any(String));
    // Granting again keeps the one active grant.
    expect(await grant(p.alex, p.grace)).toBe(grantId);

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
    expect(await revoke(p.alex, p.grace)).toBe(true);
    expect(await canRead(p.grace, p.alex)).toBe(false);
    expect(await revoke(p.alex, p.grace)).toBe(false);
    const [revoked] = await history(p.alex);
    expect(revoked).toMatchObject({ id: grantId, admin_id: p.grace.id, granted_at: row.granted_at });
    expect(new Date(revoked.revoked_at!).getTime()).toBeGreaterThanOrEqual(new Date(row.granted_at).getTime());
    expect(await visibleGrants(p.grace, p.alex)).toEqual([{ ...row, revoked_at: revoked.revoked_at }]);

    // A new grant is a new history row; revoking it again leaves two revoked rows.
    const secondId = await grant(p.alex, p.grace);
    expect(secondId).not.toBe(grantId);
    expect(await canRead(p.grace, p.alex)).toBe(true);
    expect((await history(p.alex)).map((g) => [g.id, g.revoked_at === null])).toEqual([
      [grantId, false],
      [secondId, true],
    ]);
    expect(await revoke(p.alex, p.grace)).toBe(true);
    expect(await canRead(p.grace, p.alex)).toBe(false);
    expect((await history(p.alex)).every((g) => g.revoked_at !== null)).toBe(true);
  });

  it("only the researcher grants or revokes, only to an admin, and nobody edits the history directly", async () => {
    const grantId = await grant(p.blair, p.grace);
    expect(grantId).toEqual(expect.any(String));
    const before = await history(p.blair);

    // Another researcher or the admins cannot revoke Blair's grant: revoking
    // only ever touches the caller's own grants.
    expect(await revoke(p.alex, p.grace)).toBe(false);
    expect(await revoke(p.grace, p.grace)).toBe(false);
    expect(await revoke(p.noah, p.grace)).toBe(false);
    expect(await canRead(p.grace, p.blair)).toBe(true);

    // A grant can only name an admin other than oneself.
    expect(await grant(p.blair, p.alex)).toBeNull();
    expect(await grant(p.grace, p.grace)).toBeNull();
    expect(await canRead(p.alex, p.blair)).toBe(false);

    // No direct inserts, edits or deletes, for any role, even the secret key.
    for (const client of [p.blair.client, p.grace.client, p.noah.client, serviceClient()]) {
      // Refused by privileges (42501), not failed for some other reason.
      const forged = await client.from("support_grants").insert({ researcher_id: p.blair.id, admin_id: p.noah.id });
      expect(forged.error?.code).toBe("42501");
      expect((await client.from("support_grants").update({ revoked_at: null }).eq("id", grantId!)).error?.code).toBe("42501");
      expect((await client.from("support_grants").delete().eq("id", grantId!)).error?.code).toBe("42501");
    }
    expect(await history(p.blair)).toEqual(before);
    expect(await canRead(p.noah, p.blair)).toBe(false);
    expect(await revoke(p.blair, p.grace)).toBe(true);
  });

  it("a grant works only while the grantee is an admin", async () => {
    await grant(p.alex, p.noah);
    expect(await canRead(p.noah, p.alex)).toBe(true);
    await setRole(p.noah, "researcher");
    try {
      expect(await canRead(p.noah, p.alex)).toBe(false);
      // ... and a researcher cannot be named in a new grant.
      expect(await grant(p.blair, p.noah)).toBeNull();
    } finally {
      await setRole(p.noah, "admin");
    }
    expect(await canRead(p.noah, p.alex)).toBe(true);
    expect(await revoke(p.alex, p.noah)).toBe(true);
    expect(await canRead(p.noah, p.alex)).toBe(false);
  });

  it("admins are researchers: an admin's own history is private until they grant another admin", async () => {
    expect(await canRead(p.noah, p.grace)).toBe(false);
    expect(await grant(p.grace, p.noah)).toEqual(expect.any(String));
    expect(await canRead(p.noah, p.grace)).toBe(true);
    expect(await canRead(p.alex, p.grace)).toBe(false);
    expect(await revoke(p.grace, p.noah)).toBe(true);
    expect(await canRead(p.noah, p.grace)).toBe(false);
  });
});
