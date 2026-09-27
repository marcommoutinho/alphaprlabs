// Admin invitations (Marco, 2026-09-27; 20260927160000_sellers_admin_invites.sql)
// against the real local Supabase and its Mailpit inbox: an admin invites an
// admin, the email stays anonymous and role-neutral, accepting creates an
// admin profile, and every way round it is refused: a researcher or anonymous
// caller inviting an admin, reusing a token, changing a role through the API,
// or a resend changing the role.
import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  appTestEnv,
  ensureAccount,
  latestEmail,
  ok,
  seedInvitation,
  serviceClient,
  signedInClient,
  sqlState,
  uniqueEmail,
} from "../support/local-supabase";

Object.assign(process.env, appTestEnv());
const service = await import("@/lib/invitations/service");

const admin = { email: uniqueEmail("inv-admin"), name: `Inviting Admin ${Date.now().toString(36)}` };
const researcher = { email: uniqueEmail("inv-researcher"), name: "Inv Researcher" };
const ctx = { origin: "http://app.localhost:3000" };
const PASSWORD = "long-enough-1";

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...researcher, role: "researcher" });
});

async function invitation(email: string) {
  const { data, error } = await serviceClient().from("invitations").select("id, role, state, token_hash").eq("email", email).single();
  if (error) throw new Error(`invitation: ${error.message}`);
  return data;
}
const profiles = (email: string) => ok(serviceClient().from("profiles").select("role, acknowledged_at").eq("email", email), "profiles");
const tokenIn = (text: string) => /\/auth\/invite\/([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";

describe("an admin invites an admin", () => {
  it("sends an anonymous, role-neutral email; accepting creates an admin who still acknowledges like any researcher", async () => {
    const email = uniqueEmail("inv-newcomer");
    const db = await signedInClient(admin.email);
    expect(await service.inviteResearcher(db, { name: "Natasha Park", email, role: "admin" }, ctx)).toEqual({ kind: "sent", email });
    expect(await invitation(email)).toMatchObject({ role: "admin", state: "pending" });
    expect((await service.listInvitations(db)).find((row) => row.email === email)).toMatchObject({ role: "admin", state: "pending" });

    const mail = await latestEmail(email);
    expect(mail.subject).toBe("Your invitation to Alpha PR Labs Research");
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toContain(admin.name);
      expect(part).not.toContain(admin.email);
      expect(part.toLowerCase()).not.toContain("admin");
    }
    const token = tokenIn(mail.text);
    // The invite page may say "admin access"; it still never names the inviter.
    const view = await service.viewInvitation(token);
    expect(view).toEqual({ state: "valid", name: "Natasha Park", email, expiresAt: expect.any(String), role: "admin" });
    expect(JSON.stringify(view)).not.toContain(admin.name);

    expect(await service.acceptInvitation({ token, name: "Natasha Park", password: PASSWORD })).toEqual({ ok: true, email });
    expect(await profiles(email)).toEqual([{ role: "admin", acknowledged_at: null }]);
    const newAdmin = await signedInClient(email, PASSWORD);
    expect(await ok(newAdmin.rpc("is_admin"), "is_admin")).toBe(true);
    // The back office works at once; research writes wait for the acknowledgement, as for every researcher.
    expect(await sqlState(newAdmin.rpc("admin_business_stock"))).toBe("ok");
    expect(await ok(newAdmin.rpc("is_acknowledged_researcher"), "acknowledged")).toBe(false);

    // The token is single use: a second acceptance creates nothing.
    expect(await service.acceptInvitation({ token, name: "Again", password: "long-enough-2" })).toEqual({ ok: false, reason: "invalid" });
    expect(await profiles(email)).toHaveLength(1);
  });

  it("a researcher invitation (the default) still creates a researcher", async () => {
    const email = uniqueEmail("inv-default");
    const db = await signedInClient(admin.email);
    expect(await service.inviteResearcher(db, { name: "", email }, ctx)).toEqual({ kind: "sent", email });
    expect(await invitation(email)).toMatchObject({ role: "researcher" });
    const token = tokenIn((await latestEmail(email)).text);
    expect(await service.viewInvitation(token)).toMatchObject({ state: "valid", role: "researcher" });
    expect(await service.acceptInvitation({ token, name: "Plain", password: PASSWORD })).toEqual({ ok: true, email });
    expect(await profiles(email)).toEqual([{ role: "researcher", acknowledged_at: null }]);
  });
});

describe("role escalation is refused", () => {
  it("a researcher or anonymous caller cannot create any invitation, admin or not", async () => {
    const email = uniqueEmail("inv-escalate");
    const researcherDb = await signedInClient(researcher.email);
    for (const client of [researcherDb, anonClient()]) {
      for (const role of ["admin", "researcher"] as const) {
        const call = client.rpc("invite_researcher", { p_name: "X", p_email: email, p_token_hash: "a".repeat(64), p_role: role });
        expect(await sqlState(call), role).toBe("42501");
      }
    }
    expect(await service.inviteResearcher(researcherDb, { name: "X", email, role: "admin" }, ctx)).toEqual({ kind: "error" });
    expect(await ok(serviceClient().from("invitations").select("id").eq("email", email), "rows")).toEqual([]);
  });

  it("no API role can change an invitation's role, and an unknown role is refused", async () => {
    const email = uniqueEmail("inv-role-change");
    await seedInvitation({ email, name: "Stays Researcher" });
    const row = await invitation(email);
    for (const client of [await signedInClient(admin.email), await signedInClient(researcher.email), anonClient()]) {
      expect(await sqlState(client.from("invitations").update({ role: "admin" }).eq("id", row.id))).toBe("42501");
    }
    expect(await invitation(email)).toMatchObject({ role: "researcher" });
    const db = await signedInClient(admin.email);
    expect(await service.inviteResearcher(db, { name: "", email: uniqueEmail("inv-bad-role"), role: "owner" }, ctx)).toEqual({ kind: "invalid_role" });
    const direct = db.rpc("invite_researcher", {
      p_name: "",
      p_email: uniqueEmail("inv-bad-role"),
      p_token_hash: "b".repeat(64),
      p_role: "owner" as "admin",
    });
    expect(await sqlState(direct)).toBe("22P02");
    // Accepting is server-only (secret key); complete_invitation takes no role at all.
    for (const client of [db, anonClient()]) {
      expect(await sqlState(client.rpc("complete_invitation", { p_id: row.id, p_user_id: row.id, p_name: "X" }))).toBe("42501");
    }
  });

  it("a pending invitation keeps its role; resending keeps it; re-inviting an expired one uses the role chosen now", async () => {
    const db = await signedInClient(admin.email);
    // Pending as a researcher: inviting as an admin changes nothing.
    const pending = uniqueEmail("inv-pending");
    await seedInvitation({ email: pending, name: "Pending" });
    expect(await service.inviteResearcher(db, { name: "", email: pending, role: "admin" }, ctx)).toEqual({ kind: "pending_exists", email: pending });
    expect(await invitation(pending)).toMatchObject({ role: "researcher", state: "pending" });

    // A failed admin invitation, resent: still admin, and the fresh link creates an admin.
    const failed = uniqueEmail("inv-failed-admin");
    await seedInvitation({ email: failed, name: "Failed Admin", state: "failed", role: "admin" });
    const failedRow = await invitation(failed);
    expect(await service.resendInvitation(db, failedRow.id, ctx)).toEqual({ kind: "sent", email: failed });
    expect(await invitation(failed)).toMatchObject({ role: "admin", state: "pending" });
    const token = tokenIn((await latestEmail(failed)).text);
    expect(await service.acceptInvitation({ token, name: "Failed Admin", password: PASSWORD })).toEqual({ ok: true, email: failed });
    expect(await profiles(failed)).toEqual([{ role: "admin", acknowledged_at: null }]);

    // An expired researcher invitation re-sent as an admin invitation takes the new choice, and vice versa.
    const expired = uniqueEmail("inv-expired");
    await seedInvitation({ email: expired, name: "Expired", sentDaysAgo: 31 });
    expect(await service.inviteResearcher(db, { name: "", email: expired, role: "admin" }, ctx)).toEqual({ kind: "sent", email: expired });
    expect(await invitation(expired)).toMatchObject({ role: "admin" });
    const expiredAdmin = uniqueEmail("inv-expired-admin");
    await seedInvitation({ email: expiredAdmin, name: "Expired Admin", sentDaysAgo: 31, role: "admin" });
    expect(await service.inviteResearcher(db, { name: "", email: expiredAdmin }, ctx)).toEqual({ kind: "sent", email: expiredAdmin });
    expect(await invitation(expiredAdmin)).toMatchObject({ role: "researcher" });
  });
});
