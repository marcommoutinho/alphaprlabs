// Access rules and invitation acceptance against the real local Supabase
// (npm run db:start). No mocked database. Unique emails per run.
import { createServer } from "node:net";
import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  appTestEnv,
  emailCount,
  ensureAccount,
  latestEmail,
  ok,
  seedInvitation,
  serviceClient,
  signedInClient,
  uniqueEmail,
} from "../support/local-supabase";

Object.assign(process.env, appTestEnv());
const service = await import("@/lib/invitations/service");

const admin = { email: uniqueEmail("int-admin"), name: "Int Admin" };
const researcher = { email: uniqueEmail("int-researcher"), name: "Int Researcher" };
let researcherId: string;

beforeAll(async () => {
  await ensureAccount({ ...admin, role: "admin" });
  researcherId = await ensureAccount({ ...researcher, role: "researcher" });
  await seedInvitation({ email: uniqueEmail("int-visible"), name: "Visible To Admins" });
});

const accountsFor = async (email: string) =>
  ok(serviceClient().from("profiles").select("id, role").eq("email", email));

describe("row level security", () => {
  it("anonymous and researcher clients cannot read or write invitations; admins can read", async () => {
    const researcherClient = await signedInClient(researcher.email);
    // Anonymous callers have no table privilege at all (42501); a researcher
    // may query the table but RLS shows no rows.
    expect((await anonClient().from("invitations").select("id")).error?.code).toBe("42501");
    expect(await ok(researcherClient.from("invitations").select("id"))).toEqual([]);
    for (const client of [anonClient(), researcherClient]) {
      const invite = await client.rpc("invite_researcher", {
        p_name: "X",
        p_email: uniqueEmail("nope"),
        p_token_hash: "0".repeat(64),
      });
      expect(invite.error?.code).toBe("42501");
      const claim = await client.rpc("claim_invitation", { p_token_hash: "0".repeat(64) });
      expect(claim.error?.code).toBe("42501");
    }
    const { data: adminRows } = await (await signedInClient(admin.email)).from("invitations").select("id");
    expect(adminRows?.length).toBeGreaterThan(0);
  });

  it("a researcher cannot give themselves the admin role and reads only their own profile", async () => {
    const client = await signedInClient(researcher.email);
    const update = await client.from("profiles").update({ role: "admin" }).eq("id", researcherId);
    expect(update.error).not.toBeNull();
    const insert = await client
      .from("profiles")
      .upsert({ id: researcherId, email: researcher.email, name: "X", role: "admin" });
    expect(insert.error).not.toBeNull();
    expect(await accountsFor(researcher.email)).toEqual([{ id: researcherId, role: "researcher" }]);

    const { data: visible } = await client.from("profiles").select("email");
    expect(visible).toEqual([{ email: researcher.email }]);
  });

  it("public signup is disabled", async () => {
    const email = uniqueEmail("signup");
    const { data, error } = await anonClient().auth.signUp({ email, password: "long-enough-password" });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
    expect(await accountsFor(email)).toHaveLength(0);
  });
});

describe("invitation acceptance", () => {
  it("an expired or already used token cannot create an account", async () => {
    const expiredEmail = uniqueEmail("int-expired");
    const expiredToken = await seedInvitation({ email: expiredEmail, name: "Expired", sentDaysAgo: 31 });
    expect(await service.viewInvitation(expiredToken)).toMatchObject({ state: "expired", email: expiredEmail });
    expect(await service.acceptInvitation({ token: expiredToken, name: "E", password: "long-enough-1" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await accountsFor(expiredEmail)).toHaveLength(0);

    const usedEmail = uniqueEmail("int-used");
    const usedToken = await seedInvitation({ email: usedEmail, name: "Used" });
    expect(await service.acceptInvitation({ token: usedToken, name: "U", password: "long-enough-1" })).toEqual({
      ok: true,
      email: usedEmail,
    });
    expect(await service.acceptInvitation({ token: usedToken, name: "U", password: "long-enough-2" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await service.viewInvitation(usedToken)).toEqual({ state: "used", email: usedEmail });
    expect(await accountsFor(usedEmail)).toEqual([{ id: expect.any(String), role: "researcher" }]);
  });

  it("two simultaneous acceptances create exactly one account", async () => {
    const email = uniqueEmail("int-double");
    const token = await seedInvitation({ email, name: "Double" });
    const results = await Promise.all(
      [1, 2, 3].map(() => service.acceptInvitation({ token, name: "Double", password: "long-enough-1" })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await accountsFor(email)).toHaveLength(1);
  });
});

describe("invitation sending", () => {
  const ctx = { origin: "http://app.localhost:3000", inviterName: admin.name };

  it("inviting an email whose invitation expired renews that invitation", async () => {
    const email = uniqueEmail("int-reinvite");
    await seedInvitation({ email, name: "Old", sentDaysAgo: 31 });
    const client = await signedInClient(admin.email);
    expect(await service.inviteResearcher(client, { name: "", email }, ctx)).toEqual({ kind: "sent", email });
    const { data } = await serviceClient().from("invitations").select("state, expires_at").eq("email", email);
    expect(data).toHaveLength(1);
    expect(data?.[0].state).toBe("pending");
    expect(new Date(data![0].expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("a failed send is stored as failed with its error; resend sends a fresh link", async () => {
    const client = await signedInClient(admin.email);
    const email = uniqueEmail("int-sendfail");
    // A port that was just free: the SMTP connection is refused.
    const probe = createServer();
    const port = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => resolve((probe.address() as { port: number }).port)),
    );
    await new Promise((resolve) => probe.close(resolve));
    const closedPort = { host: "127.0.0.1", port, from: "Test <test@example.test>" };

    const failed = await service.inviteResearcher(client, { name: "Send Fail", email }, { ...ctx, smtp: closedPort });
    expect(failed).toEqual({ kind: "send_failed", email });
    const { data: row } = await serviceClient()
      .from("invitations")
      .select("id, state, last_send_error, token_hash")
      .eq("email", email)
      .single();
    expect(row?.state).toBe("failed");
    expect(row?.last_send_error).toMatch(/ECONNREFUSED/);
    expect(await emailCount(email)).toBe(0);

    expect(await service.resendInvitation(client, row!.id, ctx)).toEqual({ kind: "sent", email });
    const { data: resent } = await serviceClient()
      .from("invitations")
      .select("state, last_send_error, token_hash")
      .eq("id", row!.id)
      .single();
    expect(resent).toMatchObject({ state: "pending", last_send_error: null });
    expect(resent?.token_hash).not.toBe(row?.token_hash);

    const mail = await latestEmail(email);
    const token = /\/auth\/invite\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
    expect(token && service.hashToken(token)).toBe(resent?.token_hash);
  });
});
