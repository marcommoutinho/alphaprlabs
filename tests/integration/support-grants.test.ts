// Support access and the reusable access rules against the real local
// Supabase (npm run db:start). S4's per-admin grants became S17's team share
// (20260927120000_support_history.sql): a researcher shares read-only with
// every current admin, and stopping denies them all at once. Two researchers
// and two admins are isolated until someone shares; the history keeps every
// share. No mocked database.
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
const share = (who: Person) => ok(who.client.rpc("share_with_team"), "share_with_team");
const stop = (who: Person) => ok(who.client.rpc("stop_sharing_with_team"), "stop_sharing_with_team");
const visibleShares = (viewer: Person, researcher: Person) =>
  ok(
    viewer.client.from("support_shares").select("id, researcher_id, started_at, stopped_at").eq("researcher_id", researcher.id).order("started_at"),
    "support_shares read",
  );
const history = (researcher: Person) =>
  ok(
    serviceClient().from("support_shares").select("id, started_at, stopped_at").eq("researcher_id", researcher.id).order("started_at"),
    "support_shares history",
  );
const setRole = (person: Person, role: "admin" | "researcher") =>
  ok(serviceClient().from("profiles").update({ role }).eq("id", person.id), "profile role update");

describe("without a share, everyone is isolated", () => {
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
    expect((await anonClient().rpc("share_with_team")).error?.code).toBe("42501");
    expect((await anonClient().rpc("stop_sharing_with_team")).error?.code).toBe("42501");
    expect(await canReadResearcher(anonClient(), p.alex.id)).toBe(false);
    // S4's per-admin writers are gone.
    const gone = await (p.alex.client.rpc as (fn: string, args: object) => PromiseLike<{ error: { code: string } | null }>)(
      "grant_support_access",
      { p_admin_id: p.grace.id },
    );
    expect(gone.error?.code).toBe("PGRST202");
  });

  it("an unacknowledged researcher reads their own records but cannot write them or share", async () => {
    expect(await canRead(p.una, p.una)).toBe(true);
    expect(await canWrite(p.una, p.una)).toBe(false);
    expect((await p.una.client.rpc("share_with_team")).error?.code).toBe("42501");
    expect(await history(p.una)).toEqual([]);
    expect(await canRead(p.grace, p.una)).toBe(false);
  });
});

describe("sharing and stopping", () => {
  it("a share gives every admin read-only access; stopping removes it at once for all; history keeps both", async () => {
    const shareId = await share(p.alex);
    expect(shareId).toEqual(expect.any(String));
    // Sharing again keeps the one active share.
    expect(await share(p.alex)).toBe(shareId);

    for (const admin of [p.grace, p.noah]) {
      expect(await canRead(admin, p.alex)).toBe(true);
      expect(await canWrite(admin, p.alex)).toBe(false);
    }
    // A researcher never reads through a share, and a share goes one way.
    expect(await canRead(p.blair, p.alex)).toBe(false);
    expect(await canRead(p.una, p.alex)).toBe(false);
    expect(await canRead(p.grace, p.blair)).toBe(false);
    expect(await canRead(p.alex, p.grace)).toBe(false);

    // The researcher sees their share; admins see active shares; other researchers see none.
    const [row] = await visibleShares(p.alex, p.alex);
    expect(row).toMatchObject({ id: shareId, researcher_id: p.alex.id, stopped_at: null });
    expect(await visibleShares(p.grace, p.alex)).toEqual([row]);
    expect(await visibleShares(p.noah, p.alex)).toEqual([row]);
    expect(await visibleShares(p.blair, p.alex)).toEqual([]);

    // Stop: every admin is denied from the next request, and the history keeps the share.
    expect(await stop(p.alex)).toBe(true);
    expect(await canRead(p.grace, p.alex)).toBe(false);
    expect(await canRead(p.noah, p.alex)).toBe(false);
    expect(await stop(p.alex)).toBe(false);
    const [stopped] = await history(p.alex);
    expect(stopped).toMatchObject({ id: shareId, started_at: row.started_at });
    expect(new Date(stopped.stopped_at!).getTime()).toBeGreaterThanOrEqual(new Date(row.started_at).getTime());
    // Stopped shares are the researcher's history only; admins no longer see them.
    expect(await visibleShares(p.alex, p.alex)).toEqual([{ ...row, stopped_at: stopped.stopped_at }]);
    expect(await visibleShares(p.grace, p.alex)).toEqual([]);

    // Sharing again is a new history row; stopping again leaves two stopped rows.
    const secondId = await share(p.alex);
    expect(secondId).not.toBe(shareId);
    expect(await canRead(p.grace, p.alex)).toBe(true);
    expect((await history(p.alex)).map((s) => [s.id, s.stopped_at === null])).toEqual([
      [shareId, false],
      [secondId, true],
    ]);
    expect(await stop(p.alex)).toBe(true);
    expect(await canRead(p.grace, p.alex)).toBe(false);
    expect((await history(p.alex)).every((s) => s.stopped_at !== null)).toBe(true);
  });

  it("only the researcher shares or stops their own history, and nobody edits the history directly", async () => {
    const shareId = await share(p.blair);
    const before = await history(p.blair);

    // Anyone else stopping only ever touches their own (inactive) share.
    expect(await stop(p.alex)).toBe(false);
    expect(await stop(p.grace)).toBe(false);
    expect(await canRead(p.grace, p.blair)).toBe(true);

    // No direct inserts, edits or deletes, for any role, even the secret key.
    for (const client of [p.blair.client, p.grace.client, p.noah.client, serviceClient()]) {
      // Refused by privileges (42501), not failed for some other reason.
      expect((await client.from("support_shares").insert({ researcher_id: p.blair.id })).error?.code).toBe("42501");
      expect((await client.from("support_shares").update({ stopped_at: new Date().toISOString() }).eq("id", shareId)).error?.code).toBe("42501");
      expect((await client.from("support_shares").delete().eq("id", shareId)).error?.code).toBe("42501");
    }
    // S4's grants are an archive: no API role reads or writes them.
    for (const client of [p.blair.client, p.grace.client]) {
      expect((await client.from("support_grants").select("id").limit(1)).error?.code).toBe("42501");
    }
    expect(await history(p.blair)).toEqual(before);
    expect(await stop(p.blair)).toBe(true);
  });

  it("a share works only for current admins: a demoted admin reads nothing, a newly promoted one reads at once", async () => {
    await share(p.alex);
    expect(await canRead(p.noah, p.alex)).toBe(true);
    await setRole(p.noah, "researcher");
    try {
      expect(await canRead(p.noah, p.alex)).toBe(false);
      expect(await visibleShares(p.noah, p.alex)).toEqual([]);
      expect(await canRead(p.grace, p.alex)).toBe(true);
    } finally {
      await setRole(p.noah, "admin");
    }
    // Admins added later read existing shares.
    expect(await canRead(p.noah, p.alex)).toBe(true);
    expect(await stop(p.alex)).toBe(true);
    expect(await canRead(p.noah, p.alex)).toBe(false);
  });

  it("admins are researchers: an admin's own history is private until they share, and then the other admins read it", async () => {
    expect(await canRead(p.noah, p.grace)).toBe(false);
    expect(await share(p.grace)).toEqual(expect.any(String));
    expect(await canRead(p.noah, p.grace)).toBe(true);
    // Grace reads her own history as its owner, and can still write it.
    expect(await canRead(p.grace, p.grace)).toBe(true);
    expect(await canWrite(p.grace, p.grace)).toBe(true);
    expect(await canWrite(p.noah, p.grace)).toBe(false);
    expect(await canRead(p.alex, p.grace)).toBe(false);
    expect(await stop(p.grace)).toBe(true);
    expect(await canRead(p.noah, p.grace)).toBe(false);
  });
});
