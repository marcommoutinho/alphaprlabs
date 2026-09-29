// V7 A11 / D8 People and A12 Researcher history against the real local
// Supabase, as each signed-in person: People reads every account's name,
// email, role and share state and nothing else (admin_people(), admin-only);
// a researcher who doesn't share leaks no record through it; A12 is refused
// without a share and again on the very next request after a stop, at the
// database (RLS, can_read_researcher) and at the page, which is rendered
// here as the signed-in admin (only its cookie session is swapped).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { listInvitations } from "@/lib/invitations/service";
import { listCycles } from "@/lib/cycles/service";
import { listPeople } from "@/lib/people/service";
import { peopleView } from "@/lib/people/view";
import { canReadResearcher } from "@/lib/support/access";
import { getSupportAccount } from "@/lib/support/service";
import { createCycle, createPeptide, day, interval, plan, tag, type Client } from "../support/cycles";
import { anonClient, ensureAccount, ok, seedInvitation, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

const acting = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const { default: HistoryPage } = await import("@/app/(private)/admin/people/[researcherId]/page");
const { HistoryDenied, ResearcherHistoryScreen } = await import("@/components/admin/people/researcher-history");

const admin = { email: uniqueEmail("v7-people-admin"), name: "Priya People" };
const jordan = { email: uniqueEmail("v7-people-jordan"), name: `Jordan Reyes ${tag()}` };
const kim = { email: uniqueEmail("v7-people-kim"), name: `Kim Private ${tag()}` };
const SECRET_CYCLE = `Secret protocol ${tag()}`;

let adminDb: Client;
let jordanDb: Client;
let kimDb: Client;
const id = { admin: "", jordan: "", kim: "" };

beforeAll(async () => {
  id.admin = await ensureAccount({ ...admin, role: "admin" });
  id.jordan = await ensureAccount({ ...jordan, role: "researcher" });
  id.kim = await ensureAccount({ ...kim, role: "researcher" });
  [adminDb, jordanDb, kimDb] = await Promise.all([signedInClient(admin.email), signedInClient(jordan.email), signedInClient(kim.email)]);
  const peptide = await createPeptide(adminDb, `V7 people peptide ${tag()}`);
  await createCycle(kimDb, { name: SECRET_CYCLE, goal: "Kim's own goal", plans: [plan(peptide, [interval(day(-5), day(20))])] });
  await createCycle(jordanDb, { name: `Recovery protocol ${tag()}`, plans: [plan(peptide, [interval(day(-5), day(20))])] });
});

/** What the A12 page renders for this admin and researcher: the denied state or the history. */
async function page(researcherId: string) {
  acting.client = adminDb;
  const element = (await HistoryPage({ params: Promise.resolve({ researcherId }) })) as { type: unknown; props: Record<string, unknown> };
  return element.type === HistoryDenied ? { denied: element.props } : element.type === ResearcherHistoryScreen ? { history: element.props.history as { banner: string; sub: string } } : { other: element };
}

describe("A11 / D8 People", () => {
  it("lists every account's name, email, role and share state, and nothing else", async () => {
    const people = await listPeople(adminDb);
    const kimRow = people.find((p) => p.id === id.kim)!;
    expect(kimRow).toEqual({ id: id.kim, name: kim.name, email: kim.email, role: "researcher", sharedSince: null, stoppedAt: null });
    expect(people.find((p) => p.id === id.admin)).toMatchObject({ role: "admin" });
    const raw = await ok(adminDb.rpc("admin_people").eq("profile_id", id.kim), "raw");
    expect(Object.keys(raw[0]).sort()).toEqual(["email", "name", "profile_id", "role", "shared_since", "stopped_at"]);
  });

  it("a researcher who doesn't share leaks no record through People", async () => {
    // Its own name: the e2e suite invites a "Dana Lin" too.
    const dana = `Dana Lin ${tag()}`;
    await seedInvitation({ email: uniqueEmail("v7-people-invite"), name: dana, sentDaysAgo: 40 });
    const [people, invitations] = await Promise.all([listPeople(adminDb), listInvitations(adminDb)]);
    const view = peopleView(people, invitations, id.admin);
    const payload = JSON.stringify({ people, invitations, view });
    expect(payload).toContain(kim.name);
    expect(payload).not.toContain(SECRET_CYCLE);
    expect(payload).not.toContain("Kim's own goal");
    const kimRow = view.researchers.find((row) => row.id === id.kim)!;
    expect(kimRow).toMatchObject({ status: { tone: "private", text: "Private" }, historyHref: null });
    expect(view.researchers.find((row) => row.name === dana)).toMatchObject({ kind: "invite", canResend: true, status: { tone: "expired" } });
  });

  it("is admin-only", async () => {
    for (const [who, db] of [
      ["researcher", kimDb],
      ["anonymous", anonClient()],
    ] as const) {
      expect(await sqlState(db.rpc("admin_people"), who)).toBe("42501");
    }
    expect(await ok(kimDb.from("invitations").select("id"), "researcher invitations")).toEqual([]);
  });
});

describe("A12 Researcher history", () => {
  it("is refused without a share, opens while shared, and is refused on the very next request after a stop", async () => {
    // Never shared: the database and the page refuse; the page shows only the name and email.
    expect(await canReadResearcher(adminDb, id.jordan)).toBe(false);
    expect(await listCycles(adminDb, id.jordan)).toEqual([]);
    const before = await page(id.jordan);
    expect(before).toEqual({ denied: { name: jordan.name, email: jordan.email } });

    await ok(jordanDb.rpc("share_with_team"), "share");
    const shared = await page(id.jordan);
    expect(shared.history?.banner).toMatch(/^Read-only · shared by Jordan on \w{3} \d+$/);
    expect(shared.history?.sub).toMatch(/^Recovery protocol \w+ · day 6 of 26$/);
    expect((await listPeople(adminDb)).find((p) => p.id === id.jordan)?.sharedSince).toEqual(expect.any(String));

    await ok(jordanDb.rpc("stop_sharing_with_team"), "stop");
    expect(await canReadResearcher(adminDb, id.jordan)).toBe(false);
    expect(await listCycles(adminDb, id.jordan)).toEqual([]);
    expect(await page(id.jordan)).toEqual({ denied: { name: jordan.name, email: jordan.email } });
    const after = (await listPeople(adminDb)).find((p) => p.id === id.jordan)!;
    expect(after).toMatchObject({ sharedSince: null, stoppedAt: expect.any(String) });
    expect(await getSupportAccount(adminDb, id.jordan)).toMatchObject({ sharedSince: null });
  });

  it("a researcher can't open it, and nobody reads a history without a share", async () => {
    acting.client = kimDb;
    await expect(HistoryPage({ params: Promise.resolve({ researcherId: id.jordan }) })).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(await canReadResearcher(kimDb, id.jordan)).toBe(false);
    expect(await listCycles(kimDb, id.jordan)).toEqual([]);
    // Kim's own history stays private to admins.
    expect(await listCycles(adminDb, id.kim)).toEqual([]);
    expect(await ok(serviceClient().from("cycles").select("id").eq("owner_id", id.kim), "kim's cycle exists")).toHaveLength(1);
  });
});
