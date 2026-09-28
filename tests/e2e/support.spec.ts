// S17 R11 Me and A8 Researcher support, against the real local Supabase: the
// handoff's support scenario end to end, simplified to a team share (Marco,
// 2026-09-27). The researcher shares read-only with the Alpha PR Labs team
// from Me (behind a confirm step), never naming or seeing an admin; the
// admin opens Support, then the history, and sees every card (a peptide no
// longer offered keeps its name; a deleted mixture keeps its setups) with
// nothing to edit; the researcher stops sharing (behind a confirm step), and
// the admin's next request and next navigation show the denied state.
// Cycles use a fixed-offset zone where it is about 12:00 now
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
 * stops being offered. Two admins, neither ever named to the researcher.
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
      p_effects: ["Headache", "Other"],
      p_effects_other: "dizzy",
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
  // A mixture for W saved, edited, then deleted: A8 keeps it, with both setups.
  const wSetup = { p_peptide_id: w, p_vial_mg: "5", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [] };
  const mixtureId = (await ok(db.rpc("save_mixture", wSetup), "w mixture"))!;
  await ok(db.rpc("save_mixture", { ...wSetup, p_liquid_ml: "2.5", p_mixture_id: mixtureId, p_version: 1 }), "w edit");
  const [{ version }] = await ok(db.from("mixtures").select("version").eq("id", mixtureId), "w version");
  await ok(db.rpc("delete_mixture", { p_mixture_id: mixtureId, p_version: version }), "w delete");
  await ok(serviceClient().from("peptides").update({ available: false }).eq("id", w), "withdraw W");
  return { researcher, researcherId, admin, other, A, W, cycleName, cycleId };
}

test("share with the team, read the full history read-only, stop, and the admin's next request is denied", async ({ browser }) => {
  // Two people, two browsers (the admin's session never sees the researcher's).
  test.setTimeout(90_000);
  const s = await seed();
  const researcherContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const me = await researcherContext.newPage();
  const admin = await adminContext.newPage();
  const history = `${APP_ORIGIN}/admin/support/${s.researcherId}`;
  /** Researchers never see which admin it is: no admin's name anywhere on Me. */
  const expectNoAdminNamed = async () => {
    for (const name of [s.admin.name, s.other.name, "Marco"]) await expect(me.locator("body")).not.toContainText(name);
  };

  // R8 (V4): the profile, Support access off, and the Tracking rows.
  await signInAs(me, APP_ORIGIN, s.researcher.email);
  await expect(me).toHaveURL(`${APP_ORIGIN}/app/today`);
  await me.goto(`${APP_ORIGIN}/app/me`);
  await expect(me.getByRole("heading", { level: 1 })).toHaveText(s.researcher.name);
  await expect(me.getByTestId("me-email")).toHaveText(s.researcher.email);
  await expect(me.getByTestId("me-since")).toHaveText(/^Researcher since \w{3} \d{4}$/);
  await expect(me.getByTestId("me-supplies-value")).toHaveText("On");
  await expect(me.getByTestId("me-supplements-value")).toHaveText("1 routine");
  const card = me.getByTestId("support-card");
  const sharingSwitch = me.getByRole("switch", { name: "Let admins view my history" });
  await expect(card).toHaveAttribute("data-sharing", "false");
  await expect(sharingSwitch).not.toBeChecked();
  await expect(me.getByTestId("share-event")).toHaveCount(0);
  await expectNoAdminNamed();

  // Not shared: Support doesn't list the researcher, and the history is denied.
  await signInAs(admin, APP_ORIGIN, s.admin.email);
  await expect(admin).toHaveURL(`${APP_ORIGIN}/app/today`);
  await admin.goto(`${APP_ORIGIN}/admin/support`);
  const row = admin.getByTestId("support-row").filter({ hasText: s.researcher.email });
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Researcher support");
  await expect(row).toHaveCount(0);
  await admin.goto(history);
  await expect(admin.getByTestId("support-denied")).toContainText(`${s.researcher.name} isn't sharing their history`);
  await expect(admin.getByTestId("support-denied")).toContainText("hasn't shared their history with the team");

  // Share: the switch opens R17, which names the team, never an admin.
  await (await hydrated(sharingSwitch)).click();
  const confirm = me.getByRole("dialog", { name: "Let admins view your history?" });
  await expect(confirm).toContainText("Alpha PR Labs admins");
  await expect(confirm).toContainText("Everyone with admin access to the app");
  for (const line of ["Cycles and schedules", "Logged doses and sites", "Check-ins and weight", "Vials and supplements"]) await expect(confirm).toContainText(line);
  for (const line of ["Edit anything", "Log on your behalf", "See it after you turn this off"]) await expect(confirm).toContainText(line);
  // Not now leaves it private.
  await confirm.getByRole("button", { name: "Not now" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(card).toHaveAttribute("data-sharing", "false");
  await sharingSwitch.click();
  await me.getByRole("dialog", { name: "Let admins view your history?" }).getByRole("button", { name: "Allow read-only access" }).click();
  await expect(me.getByRole("status").filter({ hasText: "Your history is shared with the Alpha PR Labs team. Stop sharing any time." })).toBeVisible();
  await expect(card).toHaveAttribute("data-sharing", "true");
  await expect(sharingSwitch).toBeChecked();
  await expect(me.getByTestId("support-since")).toHaveText(/^Shared since \w{3}, \w{3} \d+, \d{4} · \d+:\d\d [AP]M$/);
  await expect(me.getByTestId("share-event")).toHaveText([/^Shared with Alpha PR Labs admins\w{3}, /]);
  await expectNoAdminNamed();

  // A8: Support lists the researcher; the history shows every card, read-only.
  await admin.goto(`${APP_ORIGIN}/admin/support`);
  await expect(row).toContainText("Sharing");
  await expect(row).toContainText("Read-only since");
  await row.click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(s.researcher.name);
  await expect(admin.getByText(/^Read-only · shared /)).toBeVisible();
  await expect(admin.getByText(`${s.researcher.email} · full profile history · nothing here can be edited`)).toBeVisible();
  const cycles = admin.getByTestId("history-cycles");
  await expect(cycles).toContainText(s.cycleName);
  await expect(cycles).toContainText(`${s.A} + ${s.W} · goal: Leaner by October`);
  await expect(admin.getByTestId("history-doses")).toContainText(`${s.A} · 0.4 mg`);
  const checkIns = admin.getByTestId("history-checkins");
  await expect(checkIns).toContainText("feeling 4/5 · Headache, Other: dizzy");
  await expect(checkIns).toContainText("“Slept better.”");
  await expect(checkIns).toContainText("Measurements: Weight 82.4 kg");
  const supplies = admin.getByTestId("history-supplies");
  await expect(supplies).toContainText(`Supplies tracked: A-01 · ${s.A} 10 mg · est. 10 mg left`);
  await expect(supplies).toContainText("Supplement routines: Vitamin D3 2000 IU daily 00:00");
  await expect(supplies).toContainText("Taken · Vitamin D3 · 2000 IU");
  // The deleted mixture, with each setup it had.
  const mixture = admin.getByTestId("history-mixture").filter({ hasText: s.W });
  await expect(mixture).toHaveAttribute("data-deleted", "true");
  await expect(mixture).toContainText(`${s.W} · 5 mg / 2.5 mL · 1 mL`);
  await expect(mixture).toContainText(/· saved \w{3} \d+, \d{4} · deleted \w{3} \d+, \d{4}/);
  await expect(mixture.getByRole("listitem")).toHaveText([/^Setup 1 · 5 mg \/ 2 mL · 1 mL syringe · from /, /^Setup 2 · 5 mg \/ 2\.5 mL · 1 mL syringe · from /]);
  // Nothing to edit: no buttons, fields or forms in the page.
  const main = admin.getByRole("main");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.locator("input, select, textarea, form")).toHaveCount(0);

  // Stop sharing: the switch asks first (Marco, 2026-09-27); Keep sharing changes nothing.
  await sharingSwitch.click();
  const stop = me.getByRole("dialog", { name: "Stop sharing your history?" });
  await expect(stop).toContainText("The team loses access to your history from their next page or request.");
  await stop.getByRole("button", { name: "Keep sharing" }).click();
  await expect(stop).toHaveCount(0);
  await expect(card).toHaveAttribute("data-sharing", "true");
  await sharingSwitch.click();
  await me.getByRole("dialog", { name: "Stop sharing your history?" }).getByRole("button", { name: "Stop sharing" }).click();
  await expect(me.getByRole("status").filter({ hasText: "Sharing stopped. The team can no longer open your history." })).toBeVisible();
  await expect(card).toHaveAttribute("data-sharing", "false");
  await expect(me.getByTestId("support-since")).toHaveCount(0);
  // The grant history: the stop, then the share, newest first.
  await expect(me.getByTestId("share-event")).toHaveText([/^Stopped sharing\w{3}, /, /^Shared with Alpha PR Labs admins\w{3}, /]);
  await expect(me.getByTestId("share-event").first()).toHaveAttribute("data-kind", "stopped");
  await expectNoAdminNamed();

  // The admin's open history: the next request is denied ...
  await admin.reload();
  const denied = admin.getByTestId("support-denied");
  await expect(denied).toContainText(`${s.researcher.name} isn't sharing their history`);
  await expect(denied).toContainText(`${s.researcher.name} stopped sharing their history on`);
  await expect(admin.getByTestId("history-cycles")).toHaveCount(0);
  // ... Support no longer lists them, and opening them again is denied.
  await admin.getByRole("link", { name: "‹ Support" }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Researcher support");
  await expect(row).toHaveCount(0);
  await admin.goto(history);
  await expect(admin.getByTestId("support-denied")).toContainText("It's private again; only they can share it again, from their own profile.");
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
  await expect(page.getByTestId("me-supplies-value")).toHaveText("Off");
  await expect(page.getByTestId("me-supplements-value")).toHaveText("Off");
  await (await hydrated(page.getByRole("main").getByRole("button", { name: "Sign out", exact: true }))).click();
  await expect(page).toHaveURL(new RegExp(`^${APP_ORIGIN}/auth`));
  await page.goto(`${APP_ORIGIN}/app/me`);
  await expect(page).toHaveURL(new RegExp(`^${APP_ORIGIN}/auth`));
});
