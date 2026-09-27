// S17 R11 Me and A8 Researcher support, against the real local Supabase: the
// handoff's support scenario end to end. The researcher grants an admin
// read-only access from Me (behind a confirm step); the admin opens Support,
// then the history, and sees every card (a peptide no longer offered keeps
// its name) with nothing to edit; the researcher revokes (behind a confirm
// step), and the admin's next request and next navigation show the denied
// state. Cycles use a fixed-offset zone where it is about 12:00 now
// (tests/support/noon); check-ins and supplements use Toronto days.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { APP_ORIGIN } from "../../playwright.config";
import { checkInDay } from "../../src/lib/progress/rules";
import { occurrenceOn } from "../../src/lib/supplements/schedule";
import { createCycle, interval, plan, tag } from "../support/cycles";
import { d, NOON, noonZoneInstant } from "../support/noon";
import { ensureAccount, hydrated, ok, serviceClient, signedInClient, signInAs, uniqueEmail } from "../support/local-supabase";

async function peptide(name: string) {
  const { data, error } = await serviceClient().from("peptides").insert({ name, information: `[Supplied information for ${name}]`, available: true }).select("id").single();
  if (error || !data) throw new Error(`Could not seed ${name}: ${error?.message ?? "no row"}`);
  return data.id;
}

/**
 * A researcher with a full history: a cycle of A and W from today (0.4 and
 * 0.3 mg every 2 days at 08:00), today's A dose taken, a check-in with a
 * measurement, a tracked vial and a supplement routine taken today; W then
 * stops being offered. Two admins, so the researcher chooses one.
 */
async function seed() {
  const t = tag();
  const researcher = { email: uniqueEmail("s17-researcher"), name: `Jordan Reyes ${t}` };
  const admin = { email: uniqueEmail("s17-admin"), name: `Marco Support ${t}` };
  const other = { email: uniqueEmail("s17-other"), name: `Other Admin ${t}` };
  const researcherId = await ensureAccount({ ...researcher, role: "researcher" });
  await ensureAccount({ ...admin, role: "admin" });
  await ensureAccount({ ...other, role: "admin" });
  const A = `Support A ${t}`;
  const W = `Support W ${t}`;
  const [a, w] = [await peptide(A), await peptide(W)];

  const db = await signedInClient(researcher.email);
  const cycleName = `Support cycle ${t}`;
  const cycleId = await createCycle(db, {
    name: cycleName,
    goal: "Leaner by October",
    timeZone: NOON,
    plans: [plan(a, [interval(d(0), d(20), "0.4", 2, "08:00")]), plan(w, [interval(d(0), d(20), "0.3", 2, "08:00")])],
  });
  const plans = await ok(db.from("cycle_plans").select("id, peptide_id").eq("cycle_id", cycleId), "plans");
  const planA = plans.find((p) => p.peptide_id === a)!.id;
  const [phaseA] = await ok(db.from("cycle_revision_phases").select("plan_id, phase_id").eq("plan_id", planA), "phase");
  await ok(
    db.rpc("confirm_dose", {
      p_request_key: randomUUID(),
      p_occurrence_key: `${phaseA.plan_id}:${phaseA.phase_id}:0`,
      p_seen_scheduled_at: noonZoneInstant(d(0), "08:00"),
      p_seen_dose_mg: "0.4",
      p_seen_mixture_version_id: null as unknown as string,
      p_amount_mg: "0.4",
      p_site: "",
      p_notes: "",
    }),
    "confirm",
  );
  const today = checkInDay(new Date());
  await ok(
    db.rpc("save_check_in", {
      p_day: today,
      p_version: null as unknown as number,
      p_feeling: 4,
      p_effects: ["Mild headache"],
      p_note: "Slept better.",
      p_measurement_name: "Weight",
      p_measurement_value: "82.4" as unknown as number,
      p_measurement_unit: "kg",
    }),
    "check-in",
  );
  await ok(db.rpc("set_supply_tracking", { p_enabled: true }), "supplies on");
  await ok(db.rpc("save_personal_vial", { p_label: "A-01", p_peptide_id: a, p_strength_mg: "10" }), "vial");
  await ok(db.rpc("set_supplement_tracking", { p_enabled: true }), "supplements on");
  const routine = (await ok(
    db.rpc("save_supplement_routine", {
      p_id: null as unknown as string,
      p_version: null as unknown as number,
      p_name: "Vitamin D3",
      p_amount: "2000",
      p_unit: "IU",
      p_time: "00:00",
    }),
    "routine",
  )) as unknown as { id: string };
  await ok(
    db.rpc("take_supplement", {
      p_request_key: randomUUID(),
      p_occurrence_key: `${routine.id}:${today}`,
      p_seen_scheduled_at: occurrenceOn({ id: routine.id, time: "00:00", timeZone: "America/Toronto", definitionFrom: today, endDate: null }, today)!.scheduledAt,
      p_seen_name: "Vitamin D3",
      p_seen_amount: "2000",
      p_seen_unit: "IU",
    }),
    "take",
  );
  await ok(serviceClient().from("peptides").update({ available: false }).eq("id", w), "withdraw W");
  return { researcher, researcherId, admin, other, A, W, cycleName, cycleId };
}

test("grant, read the full history read-only, revoke, and the admin's next request is denied", async ({ browser }) => {
  // Two people, two browsers (the admin's session never sees the researcher's).
  test.setTimeout(90_000);
  const s = await seed();
  const researcherContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const me = await researcherContext.newPage();
  const admin = await adminContext.newPage();

  // R11: the profile and the optional features' summaries.
  await signInAs(me, APP_ORIGIN, s.researcher.email);
  await expect(me).toHaveURL(`${APP_ORIGIN}/app/today`);
  await me.goto(`${APP_ORIGIN}/app/me`);
  await expect(me.getByRole("heading", { level: 1 })).toHaveText(s.researcher.name);
  await expect(me.getByText(`${s.researcher.email} · Researcher · acknowledgement accepted`)).toBeVisible();
  await expect(me.getByTestId("me-supplies")).toHaveText("1 vial ›");
  await expect(me.getByTestId("me-supplements")).toHaveText("1 routine ›");
  await expect(me.getByTestId("support-active")).toHaveCount(0);

  // Before any grant the admin sees "No access" and the denied state.
  await signInAs(admin, APP_ORIGIN, s.admin.email);
  await expect(admin).toHaveURL(`${APP_ORIGIN}/app/today`);
  await admin.goto(`${APP_ORIGIN}/admin/support`);
  const row = admin.getByTestId("support-row").filter({ hasText: s.researcher.email });
  await expect(row).toContainText("No access");
  await expect(row).toContainText("They haven't granted access");
  await row.click();
  await expect(admin.getByTestId("support-denied")).toContainText(`${s.researcher.name} hasn't granted you access`);
  await expect(admin.getByTestId("support-denied")).toContainText("hasn't shared their history with you");

  // Grant: choose the admin, confirm.
  await (await hydrated(me.getByLabel("Admin"))).selectOption({ label: s.admin.name });
  await me.getByRole("button", { name: "Grant read-only access" }).click();
  const confirm = me.getByRole("group", { name: `Grant ${s.admin.name} access?` });
  await expect(confirm).toContainText("Covers your full profile history, not a single cycle.");
  await confirm.getByRole("button", { name: "Grant read-only access" }).click();
  await expect(me.getByRole("status").filter({ hasText: `${s.admin.name} can now read your history. Revoke any time.` })).toBeVisible();
  const active = me.getByTestId("support-active");
  await expect(active).toContainText(`${s.admin.name} has read-only access`);
  await expect(active).toContainText(/Granted \w{3} \w{3} \d+ · \d\d:\d\d · full profile history · until you revoke/);

  // A8: Support shows the grant; the history shows every card, read-only.
  await admin.getByRole("link", { name: "‹ Support" }).click();
  await expect(row).toContainText("Access granted");
  await expect(row).toContainText("Read-only since");
  await row.click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(s.researcher.name);
  await expect(admin.getByText(/^Read-only · granted /)).toBeVisible();
  await expect(admin.getByText(`${s.researcher.email} · full profile history · nothing here can be edited`)).toBeVisible();
  const cycles = admin.getByTestId("history-cycles");
  await expect(cycles).toContainText(s.cycleName);
  await expect(cycles).toContainText(`${s.A} + ${s.W} · goal: Leaner by October`);
  await expect(admin.getByTestId("history-doses")).toContainText(`${s.A} · 0.4 mg`);
  const checkIns = admin.getByTestId("history-checkins");
  await expect(checkIns).toContainText("feeling 4/5 · Mild headache");
  await expect(checkIns).toContainText("“Slept better.”");
  await expect(checkIns).toContainText("Measurements: Weight 82.4 kg");
  const supplies = admin.getByTestId("history-supplies");
  await expect(supplies).toContainText(`Supplies tracked: A-01 · ${s.A} 10 mg · est. 10 mg left`);
  await expect(supplies).toContainText("Supplement routines: Vitamin D3 2000 IU daily 00:00");
  await expect(supplies).toContainText("Taken · Vitamin D3 · 2000 IU");
  // Nothing to edit: no buttons, fields or forms in the page.
  const main = admin.getByRole("main");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.locator("input, select, textarea, form")).toHaveCount(0);

  // Revoke: confirm on Me.
  await (await hydrated(active.getByRole("button", { name: "Revoke access" }))).click();
  await expect(active).toContainText(`Revoke ${s.admin.name}'s access?`);
  await active.getByRole("button", { name: "Revoke access" }).click();
  await expect(me.getByRole("status").filter({ hasText: `Access revoked. ${s.admin.name} can no longer open your history.` })).toBeVisible();
  await expect(me.getByTestId("support-active")).toHaveCount(0);
  await expect(me.getByTestId("support-past")).toContainText(`Previously: ${s.admin.name} `);

  // The admin's open history: the next request is denied ...
  await admin.reload();
  const denied = admin.getByTestId("support-denied");
  await expect(denied).toContainText(`${s.researcher.name} hasn't granted you access`);
  await expect(denied).toContainText(`${s.researcher.name} revoked your access on`);
  await expect(admin.getByTestId("history-cycles")).toHaveCount(0);
  // ... and so is the next navigation, from the list's Revoked row.
  await admin.getByRole("link", { name: "‹ Support" }).click();
  await expect(row).toContainText("Revoked");
  await expect(row).toContainText("— opening will be denied");
  await row.click();
  await expect(admin.getByTestId("support-denied")).toContainText("Their history is private again; you'd need a new grant from them.");
  await expect(admin.getByText(s.cycleName)).toHaveCount(0);

  await researcherContext.close();
  await adminContext.close();
});

test("Me signs out", async ({ page }) => {
  const email = uniqueEmail("s17-signout");
  await ensureAccount({ email, name: "Leaving Researcher", role: "researcher" });
  await signInAs(page, APP_ORIGIN, email);
  await expect(page).toHaveURL(`${APP_ORIGIN}/app/today`);
  await page.goto(`${APP_ORIGIN}/app/me`);
  await expect(page.getByTestId("me-supplies")).toHaveText("Off ›");
  await expect(page.getByTestId("me-supplements")).toHaveText("Off ›");
  await (await hydrated(page.getByRole("main").getByRole("button", { name: "Sign out", exact: true }))).click();
  await expect(page).toHaveURL(new RegExp(`^${APP_ORIGIN}/auth`));
  await page.goto(`${APP_ORIGIN}/app/me`);
  await expect(page).toHaveURL(new RegExp(`^${APP_ORIGIN}/auth`));
});
