// S13 reminder dispatcher against the real local Supabase (npm run db:start),
// with a controllable clock (dispatchReminders' `now`) and a fake push
// transport (the push services are never called). Each scenario has its own
// researcher, device and dose times, and reads only its own device's sends:
// the dispatcher serves every account in the database, as in production.
//
// The design's proof (plan "Reminder delivery design", S13; Marco,
// 2026-09-30): a heads-up before the dose (15 minutes by default, 30 or 60
// when chosen, none when Off), a due reminder at the due minute replacing
// it, then one follow-up an hour later and nothing after; one heads-up for
// all doses planned at the same time; logging or skipping stops what is
// left; a plan edit or a plan's end suppresses stale jobs; duplicate and
// overlapping calls send nothing twice; a missed call skips the late due
// reminder (and a late heads-up) but still sends the follow-up; an
// interrupted claim is recovered; a transient failure is retried within the
// bound; a gone subscription is disabled; outdated terms or a device turned
// off get nothing; the badge; a daylight-saving change; a supplement
// reminder; and the send on/off control.
import { randomBytes, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clock12, massLabel } from "@/lib/alpha/format";
import { getCycle, listCycles, plansArgument } from "@/lib/cycles/service";
import { ownerConfirmations } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import type { HeadsUpMinutes } from "@/lib/preferences/rules";
import type { PushDeps, PushPayload } from "@/lib/push/send";
import { doseReminderText, headsUpText, supplementReminderText } from "@/lib/reminders/copy";
import { doseReminderUrl, reminderTag, reminderTopic, SUPPLEMENT_REMINDER_URL } from "@/lib/reminders/rules";
import type { ReminderKind } from "@/lib/schedule/reminders";
import { type Client, createCycle, createPeptide, day, interval, plan, saveCycle, tag, TORONTO, weekdays } from "../support/cycles";
import { confirmArgs, confirmArgsSeen, occurrenceOn } from "../support/doses";
import { anonClient, appTestEnv, ensureAccount, ok, serviceClient, signedInClient, sqlState, uniqueEmail } from "../support/local-supabase";

Object.assign(process.env, appTestEnv());
const { dispatchReminders } = await import("@/lib/reminders/dispatch");
const { disableGoneSubscription } = await import("@/lib/push/send");
const route = await import("@/app/api/cron/reminders/route");

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const MINUTE = 60_000;

/** The instant of a local date and "HH:MM" in a zone (the engine's rule for ordinary times). */
const at = (date: string, time: string, zone = TORONTO) =>
  new Date(Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from(time) }).epochMilliseconds);
const later = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MINUTE);

// ── The fake push transport ──────────────────────────────────────────────────

type Sent = { endpoint: string; payload: PushPayload; ttlSeconds: number; topic?: string; urgency: string };
const sent: Sent[] = [];
/** Per endpoint: the push service's answer to the n-th request (1-based), or an error to throw. */
const answers = new Map<string, (n: number) => number | Error>();
const requests = new Map<string, number>();

const push: PushDeps = {
  vapid: { subject: "mailto:test@example.test", publicKey: "test", privateKey: "test" },
  transport: async (request) => {
    const endpoint = request.subscription.endpoint;
    const n = (requests.get(endpoint) ?? 0) + 1;
    requests.set(endpoint, n);
    sent.push({ endpoint, payload: JSON.parse(request.payload) as PushPayload, ttlSeconds: request.ttlSeconds, topic: request.topic, urgency: request.urgency });
    const answer = answers.get(endpoint)?.(n) ?? 201;
    if (answer instanceof Error) throw answer;
    return { statusCode: answer };
  },
  disableGone: disableGoneSubscription,
};

const run = (now: Date, options: { batchSize?: number } = {}) => dispatchReminders({ db: serviceClient(), push, now, ...options });
const sentTo = (endpoint: string) => sent.filter((s) => s.endpoint === endpoint);

// ── Accounts, devices and cycles ─────────────────────────────────────────────

let adminDb: Client;
let peptideA = "";
let peptideAName = "";
let peptideB = "";
let peptideBName = "";
const devices: { db: Client; endpoint: string; deviceId: string }[] = [];

type Person = { id: string; db: Client };
async function researcher(label: string): Promise<Person> {
  const email = uniqueEmail(`s13-${label}`);
  const id = await ensureAccount({ email, name: `Reminders ${label}`, role: "researcher" });
  return { id, db: await signedInClient(email) };
}

/** Sets `person`'s Advance heads-up (Me › Notifications) through the preference writer, as they would. */
async function setHeadsUp(person: Person, minutes: HeadsUpMinutes) {
  const saved = await ok(
    person.db.rpc("save_account_preferences", {
      p_request_key: randomUUID(),
      p_request_hash: randomBytes(32).toString("hex"),
      p_heads_up_minutes: minutes,
    }),
    "heads-up setting",
  );
  expect(saved).toMatchObject({ heads_up_minutes: minutes });
}

/** A researcher with the heads-up Off: the scenarios about the due reminder and its follow-up. */
async function quietResearcher(label: string): Promise<Person> {
  const person = await researcher(label);
  await setHeadsUp(person, 0);
  return person;
}

/** Turns reminders on for a new device of `person`; returns its endpoint and subscription id. */
async function device(person: Person) {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
  const deviceId = randomUUID();
  const saved = await ok(
    person.db.rpc("save_push_subscription", {
      p_endpoint: endpoint,
      p_p256dh: randomBytes(65).toString("base64url"),
      p_auth: randomBytes(16).toString("base64url"),
      p_device_label: "Android · Chrome",
      p_device_id: deviceId,
      p_mode: "turn_on",
    }),
    "turn on reminders",
  );
  expect(saved).toBe("saved");
  devices.push({ db: person.db, endpoint, deviceId });
  const row = (await serviceClient().from("push_subscriptions").select("id").eq("endpoint", endpoint).single()).data!;
  return { endpoint, deviceId, subscriptionId: row.id };
}

const jobsOf = (subscriptionId: string) =>
  ok(
    serviceClient()
      .from("reminder_jobs")
      .select("kind, source, status, attempts, result, status_code, occurrence_key, occurrence_at, send_at, lead_minutes")
      .eq("subscription_id", subscriptionId)
      .order("send_at")
      .order("kind"),
    "jobs",
  );

async function planIdOf(db: Client, cycleId: string, peptideId: string) {
  const rows = await ok(db.from("cycle_plans").select("id").eq("cycle_id", cycleId).eq("peptide_id", peptideId), "plan id");
  return rows[0].id;
}

beforeAll(async () => {
  const adminEmail = uniqueEmail("s13-admin");
  await ensureAccount({ email: adminEmail, name: "Reminders Admin", role: "admin" });
  adminDb = await signedInClient(adminEmail);
  const t = tag();
  peptideAName = `Reminder A ${t}`;
  peptideBName = `Reminder B ${t}`;
  peptideA = await createPeptide(adminDb, peptideAName);
  peptideB = await createPeptide(adminDb, peptideBName);
});

// Devices from this run stop receiving (other runs' dispatches never plan for them).
afterAll(async () => {
  for (const { db, endpoint, deviceId } of devices) {
    await db.rpc("disable_push_subscription", { p_reason: "turned_off", p_device_id: deviceId, p_endpoint: endpoint });
  }
});

describe("dose reminders", () => {
  it("sends the default heads-up 15 minutes ahead, the due reminder at the due minute, then one follow-up an hour later, each once, with the badge", async () => {
    // Never chose a heads-up: the default, 15 minutes.
    const me = await researcher("timeline");
    const phone = await device(me);
    // Every day at 06:10 from three days ago: yesterday's dose is the one followed here.
    const cycleId = await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "06:10")])] });
    const planId = await planIdOf(me.db, cycleId, peptideA);
    // A saved mix: 8 mg in 2 mL on a 100-unit syringe, so 0.4 mg is 10 units.
    await ok(
      me.db.rpc("save_mixture", { p_peptide_id: peptideA, p_vial_mg: "8", p_liquid_ml: "2", p_syringe_units: 100, p_line_spacing: "2", p_plan_ids: [planId] }),
      "mixture",
    );
    const o = await occurrenceOn(me.db, cycleId, day(-1));
    const T = new Date(o.scheduledAt);
    expect(T).toEqual(at(day(-1), "06:10"));

    // Units only, never the syringe's size.
    const facts = { peptide: peptideAName, amount: massLabel("0.4"), time: clock12("06:10"), units: "10" };
    const tagOf = reminderTag("dose", o.key);
    const expected = (kind: ReminderKind, badge: number) => ({ ...doseReminderText(kind, facts), url: doseReminderUrl(o.key), tag: tagOf, badge });
    const badgeAt = async (when: Date) => pendingDoses(await listCycles(me.db, me.id), await ownerConfirmations(me.db, me.id), when);

    await run(later(T, -16)); // the heads-up is planned a minute ahead, not sent early
    expect(sentTo(phone.endpoint)).toEqual([]);
    await run(later(T, -15));
    // Days −3 and −2 are due and unconfirmed; day −1's is not due yet.
    expect(await badgeAt(later(T, -15))).toBe(2);
    expect(sentTo(phone.endpoint)).toEqual([
      {
        endpoint: phone.endpoint,
        // The one dose at 06:10: its own words and sheet, and its tag, so its due reminder replaces the heads-up.
        payload: { ...headsUpText({ doses: [facts], time: facts.time, lead: 15 }), url: doseReminderUrl(o.key), tag: tagOf, badge: 2 },
        ttlSeconds: 15 * 60,
        topic: reminderTopic(tagOf),
        urgency: "high",
      },
    ]);

    await run(later(T, -1)); // the due reminder is planned a minute ahead, not sent early
    expect(sentTo(phone.endpoint)).toHaveLength(1);

    await run(T);
    // Days −3, −2 and −1 are due and unconfirmed: the badge Today and the app open would show.
    expect(await badgeAt(T)).toBe(3);
    expect(sentTo(phone.endpoint).slice(1)).toEqual([
      { endpoint: phone.endpoint, payload: expected("due", 3), ttlSeconds: 60 * 60, topic: reminderTopic(tagOf), urgency: "high" },
    ]);

    // A duplicate call, and the next minutes: nothing again.
    await run(T);
    await run(later(T, 1));
    await run(later(T, 59));
    expect(sentTo(phone.endpoint)).toHaveLength(2);

    // Day −3's dose is logged meanwhile: the next badge counts two.
    const oldest = await occurrenceOn(me.db, cycleId, day(-3));
    await ok(me.db.rpc("confirm_dose", await confirmArgsSeen(me.db, oldest)), "log day −3");

    // The one follow-up at +1 hour, and nothing after it.
    for (const minutes of [60, 61, 90, 119, 120, 121, 150, 180, 240]) await run(later(T, minutes));
    const all = sentTo(phone.endpoint);
    expect(all.map((s) => s.payload).slice(1)).toEqual([expected("due", 3), expected("follow-up-1h", 2)]);
    // One tag and topic for the occurrence: each reminder replaces the earlier notification.
    expect(new Set(all.map((s) => s.payload.tag))).toEqual(new Set([tagOf]));
    expect(new Set(all.map((s) => s.topic)).size).toBe(1);
    expect(all.map((s) => s.ttlSeconds)).toEqual([15 * 60, 60 * 60, 120 * 60]);

    const jobs = await jobsOf(phone.subscriptionId);
    expect(jobs.map((j) => [j.source, j.kind, j.status, j.attempts, j.status_code, j.lead_minutes])).toEqual([
      ["heads-up", "heads-up", "sent", 1, 201, 15],
      ["dose", "due", "sent", 1, 201, null],
      ["dose", "follow-up-1h", "sent", 1, 201, null],
    ]);
    expect(jobs.filter((j) => j.source === "dose").every((j) => j.occurrence_key === o.key)).toBe(true);
  });

  it("stops the follow-up once the dose is logged or skipped", async () => {
    const me = await quietResearcher("stops");
    const phone = await device(me);
    // Two peptides at 07:20 every day, no saved mix (the notification says so).
    const cycleId = await createCycle(me.db, {
      plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.5", "07:20")]), plan(peptideB, [weekdays(day(-3), day(3), EVERY_DAY, "1.5", "07:20")])],
    });
    const [planA, planB] = [await planIdOf(me.db, cycleId, peptideA), await planIdOf(me.db, cycleId, peptideB)];
    const logged = await occurrenceOn(me.db, cycleId, day(-1), planA);
    const skipped = await occurrenceOn(me.db, cycleId, day(-1), planB);
    const T = new Date(logged.scheduledAt);

    await run(T);
    expect(sentTo(phone.endpoint).map((s) => s.payload.tag).sort()).toEqual([reminderTag("dose", logged.key), reminderTag("dose", skipped.key)].sort());
    expect(sentTo(phone.endpoint).find((s) => s.payload.tag === reminderTag("dose", logged.key))!.payload).toMatchObject(
      doseReminderText("due", { peptide: peptideAName, amount: massLabel("0.5"), time: clock12("07:20"), units: null }),
    );

    // The follow-ups are queued a minute ahead; then one dose is logged and the other skipped.
    await run(later(T, 59));
    await ok(me.db.rpc("confirm_dose", confirmArgs(logged)), "log");
    await ok(
      me.db.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: skipped.key, p_seen_scheduled_at: skipped.scheduledAt, p_seen_dose_mg: skipped.doseMg }),
      "skip",
    );
    await run(later(T, 60));
    await run(later(T, 120));
    await run(later(T, 180));
    expect(sentTo(phone.endpoint)).toHaveLength(2);
    const jobs = await jobsOf(phone.subscriptionId);
    expect(jobs.filter((j) => j.kind === "follow-up-1h").map((j) => [j.occurrence_key, j.status, j.result]).sort()).toEqual(
      [
        [logged.key, "suppressed", "logged"],
        [skipped.key, "suppressed", "skipped"],
      ].sort(),
    );
    // Only the due reminders and the follow-ups: no other reminder, and no heads-up with it Off.
    expect(jobs.map((j) => j.kind).sort()).toEqual(["due", "due", "follow-up-1h", "follow-up-1h"]);
  });

  it("suppresses stale jobs after a plan edit moves a dose or ends the plan, and reminds the moved dose at its new time", async () => {
    const me = await quietResearcher("edits");
    const phone = await device(me);
    // Future doses at 09:40 every day; the one in two days is queued, then the cycle is edited from tomorrow.
    const cycleId = await createCycle(me.db, {
      plans: [plan(peptideA, [interval(day(-1), day(6), "0.3", 1, "09:40")]), plan(peptideB, [weekdays(day(-1), day(6), EVERY_DAY, "0.2", "09:40")])],
    });
    const planA = await planIdOf(me.db, cycleId, peptideA);
    const moving = await occurrenceOn(me.db, cycleId, day(2), planA);
    const T = new Date(moving.scheduledAt);
    expect(T).toEqual(at(day(2), "09:40"));
    await run(later(T, -1));
    expect((await jobsOf(phone.subscriptionId)).map((j) => j.status)).toEqual(["pending", "pending"]);

    // From tomorrow: peptide A's time moves to 10:40, and peptide B's plan ends tomorrow.
    const cycle = (await getCycle(me.db, cycleId))!;
    const revision = cycle.revisions.at(-1)!;
    const plans = plansArgument(revision.plans.map((p) => ({ ...p, effectiveFrom: day(1) }))) as { plan_id: string; phases: Record<string, unknown>[] }[];
    const a = plans.find((p) => p.plan_id === planA)!;
    a.phases[0].time_changes = [{ from: day(1), local_time: "10:40" }];
    const b = plans.find((p) => p.plan_id !== planA)!;
    b.phases[0].end_date = day(1);
    await ok(saveCycle(me.db, { cycleId, version: cycle.version, plans }), "edit");

    await run(T);
    expect(sentTo(phone.endpoint)).toEqual([]);
    expect((await jobsOf(phone.subscriptionId)).map((j) => [j.status, j.result]).sort()).toEqual([
      ["suppressed", "occurrence gone"],
      ["suppressed", "occurrence moved"],
    ]);

    // The moved dose keeps its key and is reminded at 10:40.
    const moved = await occurrenceOn(me.db, cycleId, day(2), planA);
    expect(moved.key).toBe(moving.key);
    await run(at(day(2), "10:40"));
    expect(sentTo(phone.endpoint).map((s) => [s.payload.url, s.payload.body])).toEqual([
      [doseReminderUrl(moved.key), doseReminderText("due", { peptide: peptideAName, amount: massLabel("0.3"), time: clock12("10:40"), units: null }).body],
    ]);
  });

  it("sends nothing twice when two calls overlap", async () => {
    const me = await quietResearcher("overlap");
    const phones = [await device(me), await device(me), await device(me)];
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "05:05")])] });
    const T = at(day(-2), "05:05");
    // Two calls at once, claiming one job at a time so their claims interleave.
    await Promise.all([run(T, { batchSize: 1 }), run(T, { batchSize: 1 }), run(T)]);
    for (const phone of phones) {
      expect(sentTo(phone.endpoint)).toHaveLength(1);
      expect((await jobsOf(phone.subscriptionId)).map((j) => [j.kind, j.status, j.attempts])).toEqual([["due", "sent", 1]]);
    }
  });

  it("skips a due reminder more than 15 minutes late after a missed call, and still sends the follow-up", async () => {
    const me = await quietResearcher("missed");
    const phone = await device(me);
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "04:15")])] });
    const T = at(day(-2), "04:15");
    await run(later(T, -1));
    // The call at the due minute never happens; the next one comes 20 minutes later.
    await run(later(T, 20));
    expect(sentTo(phone.endpoint)).toEqual([]);
    // Down again from just before the follow-up's time: it still goes out 30 minutes late.
    await run(later(T, 90));
    await run(later(T, 180));
    const facts = { peptide: peptideAName, amount: massLabel("0.4"), time: clock12("04:15"), units: null };
    expect(sentTo(phone.endpoint).map((s) => [s.payload.title, s.payload.body])).toEqual([Object.values(doseReminderText("follow-up-1h", facts))]);
    expect((await jobsOf(phone.subscriptionId)).map((j) => [j.kind, j.status, j.result])).toEqual([
      ["due", "suppressed", "late"],
      ["follow-up-1h", "sent", ""],
    ]);
  });

  it("recovers an interrupted claim once its lease expires", async () => {
    const me = await quietResearcher("lease");
    const phone = await device(me);
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "03:25")])] });
    const T = at(day(-2), "03:25");
    await run(later(T, -1));
    // A call claims the due jobs (a 120-second lease) and dies before sending or recording anything.
    const lost = await ok(
      serviceClient().rpc("claim_reminder_jobs", { p_now: T.toISOString(), p_limit: 100, p_lease_seconds: 120, p_max_attempts: 3 }),
      "claim and crash",
    );
    const mine = lost.find((job) => job.subscription_id === phone.subscriptionId)!;
    expect(mine).toMatchObject({ kind: "due", attempts: 1, device_on: true, owner_agreed: true });

    await run(later(T, 1)); // the lease still holds
    expect(sentTo(phone.endpoint)).toEqual([]);
    await run(later(T, 3)); // expired: taken over and sent
    expect(sentTo(phone.endpoint)).toHaveLength(1);
    // The interrupted call can no longer record anything under its old lease.
    expect(await ok(serviceClient().rpc("finish_reminder_job", { p_id: mine.id, p_lease_token: mine.lease_token, p_outcome: "failed", p_result: "late" }), "late finish")).toBe(false);
    expect((await jobsOf(phone.subscriptionId)).map((j) => [j.kind, j.status, j.attempts])).toEqual([["due", "sent", 2]]);
  });

  it("retries a transient failure within the bound, and gives up after the last attempt", async () => {
    const me = await quietResearcher("retry");
    const [flaky, down] = [await device(me), await device(me)];
    answers.set(flaky.endpoint, (n) => (n === 1 ? 503 : 201));
    answers.set(down.endpoint, (n) => (n % 2 ? new Error("ECONNRESET") : 500));
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "02:35")])] });
    const T = at(day(-2), "02:35");

    await run(T);
    expect((await jobsOf(flaky.subscriptionId)).map((j) => [j.status, j.attempts, j.status_code])).toEqual([["pending", 1, 503]]);
    await run(later(T, 1));
    expect((await jobsOf(flaky.subscriptionId)).map((j) => [j.status, j.attempts, j.status_code])).toEqual([["sent", 2, 201]]);
    await run(later(T, 3));
    await run(later(T, 10));
    expect(sentTo(flaky.endpoint)).toHaveLength(2);
    // Three attempts (at T, T+1 and T+3 minutes), then failed for good.
    expect(sentTo(down.endpoint)).toHaveLength(3);
    expect((await jobsOf(down.subscriptionId)).map((j) => [j.status, j.attempts, j.result])).toEqual([["failed", 3, "ECONNRESET"]]);
  });

  it("disables a gone subscription and sends it nothing more", async () => {
    const me = await quietResearcher("gone");
    const phone = await device(me);
    answers.set(phone.endpoint, () => 410);
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "01:45")])] });
    const T = at(day(-2), "01:45");
    await run(T);
    await run(later(T, 60));
    await run(later(T, 120));
    expect(sentTo(phone.endpoint)).toHaveLength(1);
    expect((await jobsOf(phone.subscriptionId)).map((j) => [j.kind, j.status, j.status_code])).toEqual([["due", "gone", 410]]);
    const row = (await serviceClient().from("push_subscriptions").select("disabled_reason").eq("id", phone.subscriptionId).single()).data!;
    expect(row.disabled_reason).toBe("gone");
  });

  it("sends nothing to an owner whose terms are outdated, or to a device turned off", async () => {
    const outdated = await quietResearcher("terms");
    const off = await quietResearcher("off");
    const [termsPhone, offPhone] = [await device(outdated), await device(off)];
    for (const who of [outdated, off]) {
      await createCycle(who.db, { plans: [plan(peptideA, [weekdays(day(-3), day(3), EVERY_DAY, "0.4", "00:55")])] });
    }
    const T = at(day(-2), "00:55");
    await run(later(T, -1));
    // Queued; then one owner's agreement falls behind the current terms and the other phone is turned off.
    await ok(serviceClient().from("profiles").update({ acknowledgement_version: "2026-09-placeholder" }).eq("id", outdated.id), "old terms");
    const offDevice = devices.find((d) => d.endpoint === offPhone.endpoint)!;
    await ok(off.db.rpc("disable_push_subscription", { p_reason: "turned_off", p_device_id: offDevice.deviceId, p_endpoint: offPhone.endpoint }), "turn off");
    await run(T);
    await run(later(T, 60));
    expect(sentTo(termsPhone.endpoint)).toEqual([]);
    expect(sentTo(offPhone.endpoint)).toEqual([]);
    expect((await jobsOf(termsPhone.subscriptionId)).map((j) => [j.kind, j.status, j.result])).toEqual([["due", "suppressed", "terms outdated"]]);
    expect((await jobsOf(offPhone.subscriptionId)).map((j) => [j.kind, j.status, j.result])).toEqual([["due", "suppressed", "device off"]]);
  });

  it("follows the phone's clock across a daylight-saving change", async () => {
    const me = await quietResearcher("dst");
    const phone = await device(me);
    // The next change of clocks in Toronto, and a dose every day at 08:05 around it.
    const change = Temporal.Now.zonedDateTimeISO(TORONTO).getTimeZoneTransition("next")!;
    const changeDay = change.toPlainDate().toString();
    const before = Temporal.PlainDate.from(changeDay).subtract({ days: 1 }).toString();
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(before, changeDay, EVERY_DAY, "0.4", "08:05")])] });
    const [first, second] = [at(before, "08:05"), at(changeDay, "08:05")];
    // 08:05 on both days, an hour apart in UTC terms from the day before plus 24 hours.
    expect(Math.abs(second.getTime() - first.getTime() - 24 * 60 * MINUTE)).toBe(60 * MINUTE);
    await run(first);
    await run(later(first, 24 * 60)); // same UTC time the next day: not 08:05 there any more
    expect(sentTo(phone.endpoint)).toHaveLength(1);
    await run(second);
    const all = sentTo(phone.endpoint);
    expect(all).toHaveLength(2);
    for (const s of all) expect(s.payload.body).toBe(doseReminderText("due", { peptide: peptideAName, amount: massLabel("0.4"), time: clock12("08:05"), units: null }).body);
    expect((await jobsOf(phone.subscriptionId)).map((j) => new Date(j.occurrence_at).getTime())).toEqual([first.getTime(), second.getTime()]);
  });
});

describe("the heads-up before a dose", () => {
  // Each scenario's doses are on day −2 only, at its own time, so no other scenario's calls plan them.
  const once = (peptideId: string, dose: string, time: string) => plan(peptideId, [weekdays(day(-2), day(-2), EVERY_DAY, dose, time)]);
  const kindsOf = async (subscriptionId: string) => (await jobsOf(subscriptionId)).map((j) => [j.kind, j.status, j.result, j.lead_minutes]);

  it("goes out 15, 30 or 60 minutes ahead as the owner chose, never when Off", async () => {
    const cases: { label: string; lead: HeadsUpMinutes; time: string }[] = [
      { label: "lead-15", lead: 15, time: "13:30" },
      { label: "lead-30", lead: 30, time: "14:40" },
      { label: "lead-60", lead: 60, time: "15:50" },
      { label: "lead-off", lead: 0, time: "17:00" },
    ];
    for (const { label, lead, time } of cases) {
      const me = await researcher(label);
      await setHeadsUp(me, lead);
      const phone = await device(me);
      const cycleId = await createCycle(me.db, { plans: [once(peptideA, "2", time)] });
      const o = await occurrenceOn(me.db, cycleId, day(-2));
      const T = at(day(-2), time);
      const facts = { peptide: peptideAName, amount: massLabel("2"), units: null };

      for (const minutes of [-61, -60, -31, -30, -16, -15, -1]) {
        await run(later(T, minutes));
        // Sent at its lead, not a minute before.
        const expected = lead > 0 && minutes >= -lead ? 1 : 0;
        expect(sentTo(phone.endpoint), `${label} at ${minutes}`).toHaveLength(expected);
      }
      if (lead > 0) {
        expect(sentTo(phone.endpoint)[0].payload).toEqual({
          ...headsUpText({ doses: [facts], time: clock12(time), lead: lead as 15 | 30 | 60 }),
          url: doseReminderUrl(o.key),
          tag: reminderTag("dose", o.key),
          badge: expect.any(Number),
        });
        expect((await kindsOf(phone.subscriptionId)).filter(([kind]) => kind === "heads-up")).toEqual([["heads-up", "sent", "", lead]]);
      } else {
        expect((await kindsOf(phone.subscriptionId)).map(([kind]) => kind)).toEqual(["due"]);
      }
      await run(T);
      // The due reminder follows, under the same tag.
      expect(sentTo(phone.endpoint).at(-1)!.payload).toMatchObject({ ...doseReminderText("due", { ...facts, time: clock12(time) }), tag: reminderTag("dose", o.key) });
    }
  });

  it("groups every dose planned at the same time into one heads-up per device, which the first dose's due reminder replaces", async () => {
    const me = await researcher("group");
    const phones = [await device(me), await device(me)];
    const cycleId = await createCycle(me.db, { plans: [once(peptideA, "0.25", "18:10"), once(peptideB, "2", "18:10")] });
    const [planA, planB] = [await planIdOf(me.db, cycleId, peptideA), await planIdOf(me.db, cycleId, peptideB)];
    // In Today's order: the same time, then by occurrence key.
    const doses = [
      { o: await occurrenceOn(me.db, cycleId, day(-2), planA), peptide: peptideAName, amount: massLabel("0.25") },
      { o: await occurrenceOn(me.db, cycleId, day(-2), planB), peptide: peptideBName, amount: massLabel("2") },
    ].sort((x, y) => x.o.key.localeCompare(y.o.key));
    const T = at(day(-2), "18:10");
    const firstTag = reminderTag("dose", doses[0].o.key);

    await run(later(T, -15));
    for (const phone of phones) {
      const [headsUp] = sentTo(phone.endpoint);
      expect(sentTo(phone.endpoint)).toHaveLength(1);
      expect(headsUp.payload).toEqual({
        ...headsUpText({ doses: doses.map((d) => ({ peptide: d.peptide, amount: d.amount, units: null })), time: clock12("18:10"), lead: 15 }),
        url: "/app/today",
        tag: firstTag,
        badge: expect.any(Number),
      });
      expect(headsUp.topic).toBe(reminderTopic(firstTag));
      expect((await kindsOf(phone.subscriptionId)).filter(([kind]) => kind === "heads-up")).toEqual([["heads-up", "sent", "", 15]]);
    }

    await run(T);
    for (const phone of phones) {
      const due = sentTo(phone.endpoint).slice(1);
      expect(due.map((s) => s.payload.tag).sort()).toEqual(doses.map((d) => reminderTag("dose", d.o.key)).sort());
      // The first dose's due reminder takes the heads-up's place (same tag and topic); the other has its own.
      expect(due.find((s) => s.payload.tag === firstTag)!.topic).toBe(sentTo(phone.endpoint)[0].topic);
    }
  });

  it("is skipped once every dose at that time is logged or skipped, and names only the doses still open", async () => {
    const me = await researcher("resolved");
    const phone = await device(me);
    // Two doses at 19:20 (one logged, one skipped before the heads-up), and two at 20:30 (one logged).
    const cycleId = await createCycle(me.db, {
      plans: [
        plan(peptideA, [weekdays(day(-2), day(-2), EVERY_DAY, "0.25", "19:20"), weekdays(day(-1), day(-1), EVERY_DAY, "0.25", "20:30")]),
        plan(peptideB, [weekdays(day(-2), day(-2), EVERY_DAY, "2", "19:20"), weekdays(day(-1), day(-1), EVERY_DAY, "2", "20:30")]),
      ],
    });
    const [planA, planB] = [await planIdOf(me.db, cycleId, peptideA), await planIdOf(me.db, cycleId, peptideB)];
    const skip = (o: { key: string; scheduledAt: string; doseMg: string }) =>
      ok(me.db.rpc("skip_dose", { p_request_key: randomUUID(), p_occurrence_key: o.key, p_seen_scheduled_at: o.scheduledAt, p_seen_dose_mg: o.doseMg }), "skip");

    const T1 = at(day(-2), "19:20");
    await run(later(T1, -16)); // planned
    await ok(me.db.rpc("confirm_dose", confirmArgs(await occurrenceOn(me.db, cycleId, day(-2), planA))), "log A");
    await skip(await occurrenceOn(me.db, cycleId, day(-2), planB));
    await run(later(T1, -15));
    expect(sentTo(phone.endpoint)).toEqual([]);
    expect(await kindsOf(phone.subscriptionId)).toEqual([["heads-up", "suppressed", "logged", 15]]);

    const T2 = at(day(-1), "20:30");
    await run(later(T2, -16));
    await ok(me.db.rpc("confirm_dose", confirmArgs(await occurrenceOn(me.db, cycleId, day(-1), planA))), "log A");
    await run(later(T2, -15));
    const open = await occurrenceOn(me.db, cycleId, day(-1), planB);
    // One dose left: the one-dose words, its sheet and its tag.
    expect(sentTo(phone.endpoint).map((s) => s.payload)).toEqual([
      {
        ...headsUpText({ doses: [{ peptide: peptideBName, amount: massLabel("2"), units: null }], time: clock12("20:30"), lead: 15 }),
        url: doseReminderUrl(open.key),
        tag: reminderTag("dose", open.key),
        badge: expect.any(Number),
      },
    ]);
  });

  it("is skipped when late, once the time has come, after the setting changed, for outdated terms or a device turned off", async () => {
    // A missed call: the next one comes 16 minutes after the heads-up's time.
    const missed = await researcher("hu-missed");
    await setHeadsUp(missed, 60);
    const missedPhone = await device(missed);
    await createCycle(missed.db, { plans: [once(peptideA, "0.4", "21:40")] });
    const T = at(day(-2), "21:40");
    await run(later(T, -61));
    await run(later(T, -44));
    expect(sentTo(missedPhone.endpoint)).toEqual([]);
    expect((await kindsOf(missedPhone.subscriptionId))[0]).toEqual(["heads-up", "suppressed", "late", 60]);

    // First planned when the time has already come (the dispatcher was down): never sent after the time.
    const past = await researcher("hu-past");
    const pastPhone = await device(past);
    await createCycle(past.db, { plans: [once(peptideA, "0.4", "22:10")] });
    await run(at(day(-2), "22:10"));
    expect(sentTo(pastPhone.endpoint).map((s) => s.payload.title)).toEqual([
      doseReminderText("due", { peptide: peptideAName, amount: massLabel("0.4"), time: clock12("22:10"), units: null }).title,
    ]);
    expect((await kindsOf(pastPhone.subscriptionId))[0]).toEqual(["heads-up", "suppressed", "late", 15]);

    // Planned, then the setting changes (to Off, and to another lead), the terms move on, or the phone is turned off.
    const T3 = at(day(-2), "23:00");
    const people = await Promise.all(["hu-off", "hu-60", "hu-terms", "hu-device"].map((label) => researcher(label)));
    const phones: Awaited<ReturnType<typeof device>>[] = [];
    for (const who of people) {
      phones.push(await device(who));
      await createCycle(who.db, { plans: [once(peptideA, "0.4", "23:00")] });
    }
    await run(later(T3, -16));
    await setHeadsUp(people[0], 0);
    // (An hour ahead is already past: that lead plans nothing now.)
    await setHeadsUp(people[1], 60);
    await ok(serviceClient().from("profiles").update({ acknowledgement_version: "2026-09-placeholder" }).eq("id", people[2].id), "old terms");
    const offDevice = devices.find((d) => d.endpoint === phones[3].endpoint)!;
    await ok(people[3].db.rpc("disable_push_subscription", { p_reason: "turned_off", p_device_id: offDevice.deviceId, p_endpoint: offDevice.endpoint }), "turn off");
    await run(later(T3, -15));
    const results = await Promise.all(phones.map(async (phone) => [sentTo(phone.endpoint).length, (await kindsOf(phone.subscriptionId))[0]]));
    expect(results).toEqual([
      [0, ["heads-up", "suppressed", "setting changed", 15]],
      [0, ["heads-up", "suppressed", "setting changed", 15]],
      [0, ["heads-up", "suppressed", "terms outdated", 15]],
      [0, ["heads-up", "suppressed", "device off", 15]],
    ]);
  });
});

describe("supplement reminders", () => {
  it("sends one reminder when due, opening Today, with no follow-ups; a Taken before it stops it", async () => {
    const me = await researcher("supplement");
    const phone = await device(me);
    await ok(me.db.rpc("set_supplement_tracking", { p_enabled: true }), "tracking on");
    const save = (name: string, time: string) =>
      ok(
        me.db.rpc("save_supplement_routine", {
          p_id: null as unknown as string,
          p_version: null as unknown as number,
          p_name: name,
          p_amount: "2000",
          p_unit: "IU",
          p_time: time,
        }),
        "routine",
      ) as unknown as Promise<{ id: string }>;
    const routine = await save("Vitamin D3", "11:50");
    const other = await save("Magnesium", "12:50");
    // Created today in Toronto, as the server judged it.
    const today = (await serviceClient().from("supplement_routines").select("start_date").eq("id", routine.id).single()).data!.start_date;
    const T = at(today, "11:50");
    await run(T);
    await run(later(T, 30));
    await run(later(T, 120));
    expect(sentTo(phone.endpoint).map((s) => s.payload)).toEqual([
      {
        ...supplementReminderText({ supplement: "Vitamin D3", amount: "2000 IU" }),
        url: SUPPLEMENT_REMINDER_URL,
        tag: reminderTag("supplement", `${routine.id}:${today}`),
        badge: 0, // supplements never count
      },
    ]);

    // The other routine is queued, then taken before its minute.
    const T2 = at(today, "12:50");
    await run(later(T2, -1));
    await ok(
      me.db.rpc("take_supplement", {
        p_request_key: randomUUID(),
        p_occurrence_key: `${other.id}:${today}`,
        p_seen_scheduled_at: T2.toISOString(),
        p_seen_name: "Magnesium",
        p_seen_amount: "2000",
        p_seen_unit: "IU",
      }),
      "take",
    );
    await run(T2);
    expect(sentTo(phone.endpoint)).toHaveLength(1);
    expect((await jobsOf(phone.subscriptionId)).map((j) => [j.source, j.kind, j.status, j.result])).toEqual([
      ["supplement", "due", "sent", ""],
      ["supplement", "due", "suppressed", "logged"],
    ]);
  });
});

describe("the queue is server-only", () => {
  it("no signed-in or anonymous caller reads the jobs or calls the queue functions", async () => {
    const me = await researcher("access");
    const now = new Date().toISOString();
    for (const client of [me.db, adminDb, anonClient()]) {
      const read = await client.from("reminder_jobs").select("id").limit(1);
      expect(read.error?.code).toBe("42501");
      for (const [fn, args] of [
        ["plan_reminder_jobs", { p_now: now }],
        ["claim_reminder_jobs", { p_now: now, p_limit: 1, p_lease_seconds: 120, p_max_attempts: 3 }],
        ["finish_reminder_job", { p_id: randomUUID(), p_lease_token: randomUUID(), p_outcome: "sent" }],
      ] as const) {
        expect(await sqlState(client.rpc(fn, args as never), fn), fn).toBe("42501");
      }
    }
    // The service role refuses what makes no sense.
    expect(await sqlState(serviceClient().rpc("claim_reminder_jobs", { p_now: now, p_limit: 0 }), "no batch")).toBe("22023");
    expect(await sqlState(serviceClient().rpc("finish_reminder_job", { p_id: randomUUID(), p_lease_token: randomUUID(), p_outcome: "retry" }), "retry without a time")).toBe("22023");
  });
});

describe("the dispatcher route", () => {
  const call = (secret?: string) =>
    route.GET(new Request("http://localhost/api/cron/reminders", secret ? { headers: { authorization: `Bearer ${secret}` } } : {}));

  it("needs the cron secret, and plans and sends nothing unless REMINDERS_ENABLED is true", async () => {
    const me = await researcher("switch");
    const phone = await device(me);
    // A dose due right now, which the route would plan if it ran.
    const now = Temporal.Now.zonedDateTimeISO(TORONTO);
    const time = now.toPlainTime().toString().slice(0, 5);
    await createCycle(me.db, { plans: [plan(peptideA, [weekdays(day(-1), day(1), EVERY_DAY, "0.4", time)])] });

    vi.stubEnv("CRON_SECRET", "s13-test-secret-value");
    try {
      expect((await call()).status).toBe(401);
      expect((await call("wrong-secret-value-000")).status).toBe(401);
      vi.stubEnv("REMINDERS_ENABLED", "");
      const off = await call("s13-test-secret-value");
      expect(off.status).toBe(200);
      expect(await off.json()).toEqual({ enabled: false });
      vi.stubEnv("REMINDERS_ENABLED", "yes");
      expect(await (await call("s13-test-secret-value")).json()).toEqual({ enabled: false });
      // On, but without VAPID keys nothing can be sent: it says so and plans nothing (no real push in tests).
      vi.stubEnv("REMINDERS_ENABLED", "true");
      vi.stubEnv("VAPID_PRIVATE_KEY", "");
      const unconfigured = await call("s13-test-secret-value");
      expect(unconfigured.status).toBe(500);
      expect(await unconfigured.json()).toEqual({ enabled: true, error: "push not configured" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await jobsOf(phone.subscriptionId)).toEqual([]);
    expect(sentTo(phone.endpoint)).toEqual([]);
  });
});
