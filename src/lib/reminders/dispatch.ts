import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock12, massLabel } from "@/lib/alpha/format";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import { listCyclePeptides, listCycles } from "@/lib/cycles/service";
import { drawDisplay } from "@/lib/doses/rules";
import { ownerConfirmations } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import type { Mixture } from "@/lib/mixtures/rules";
import { planMixtures } from "@/lib/mixtures/service";
import { type HeadsUpMinutes, resolvePreferences } from "@/lib/preferences/rules";
import { type PushDeps, type PushPayload, type PushSendResult, sendPush, UNKNOWN_ENDPOINT } from "@/lib/push/send";
import type { Occurrence } from "@/lib/schedule/engine";
import type { ReminderKind } from "@/lib/schedule/reminders";
import type { Database } from "@/lib/supabase/database.types";
import { listDueSupplements, type DueSupplement } from "@/lib/supplements/service";
import { doseReminderText, headsUpText, supplementReminderText } from "./copy";
import {
  doseReminderUrl,
  doseVerdict,
  headsUpDoses,
  headsUpTag,
  headsUpUrl,
  headsUpVerdict,
  isTransientFailure,
  type JobKind,
  MAX_ATTEMPTS,
  type ReminderSource,
  reminderTag,
  reminderTopic,
  reminderTtlSeconds,
  retryAt,
  SUPPLEMENT_REMINDER_URL,
  supplementVerdict,
  type Suppression,
  type Verdict,
} from "./rules";

// S13: the reminder dispatcher (plan "Reminder delivery design"). One call,
// every minute from /api/cron/reminders (vercel.json; locally `npm run
// reminders:tick`), with the secret-key client:
//   1. plans the reminders due around now (plan_reminder_jobs, idempotent),
//      bounded (DISPATCH_LIMITS: plan expansions, supplement rows, and
//      planning's share of the call's time, so sending always keeps the
//      rest; what is left is planned by the next call);
//   2. claims a bounded batch with a lease (claim_reminder_jobs: FOR UPDATE
//      SKIP LOCKED, so overlapping calls never share a job; an interrupted
//      call's jobs come back once their lease expires), one job per device,
//      sent to the device's newest active subscription;
//   3. rechecks each job against the owner's records, read afresh for every
//      batch after its claim (./rules doseVerdict / headsUpVerdict /
//      supplementVerdict; the device and the terms come with the claim), and
//      right before sending checks again that nothing it was judged on
//      changed (the plans' schedule_version, the heads-up setting) and that
//      the subscription is still the owner's, active, with the same endpoint
//      and keys; it suppresses what is no longer true;
//   4. sends the rest through sendPush with a TTL that ends with the
//      reminder's relevance, a topic and tag per occurrence (a follow-up
//      replaces the earlier reminder; the first dose's due reminder replaces
//      a heads-up: ./rules headsUpTag) and the app badge;
//   5. records each outcome honestly (finish_reminder_job, only under its
//      own lease): "sent" is the push service's acceptance, nothing more;
//      transient failures go back to pending for a bounded retry.
// It repeats 2-5 while batches come back full and the time budget lasts, so
// a call stays well inside the function's limit and a missed call is caught
// up by the next. The clock is the database's (plan_reminder_jobs returns
// it) unless one is passed in (tests).
//
// The recheck reads the same records, with the same code, as Today and the
// app badge: listCycles + ownerConfirmations (recorded and skipped doses) +
// planOccurrences for the occurrence, planMixtures for the units in the
// notification, and pendingDoses for the badge (src/app/(private)/app/today/
// badge/route.ts), so the tap opens exactly what the notification said, or
// Today's out-of-date notice when something changed since. A heads-up also
// reads the owner's Advance heads-up setting (account_preferences).

type Db = SupabaseClient<Database>;

export type ClaimedJob = Database["public"]["Functions"]["claim_reminder_jobs"]["Returns"][number];

export type DispatchOptions = {
  /** The secret-key client (the queue functions are the service role's only). */
  db: Db;
  push: PushDeps;
  /** The clock (tests). Default: the database's now(). */
  now?: Date;
  /** Jobs per claim (≤ 100). */
  batchSize?: number;
  /** The whole call's time (ms): planning, then claims and sends; no new batch is claimed after it. The route's maxDuration is well above it. */
  budgetMs?: number;
  /** Planning's share of budgetMs (ms): it starts no new work after it, so sending always keeps the rest. */
  planBudgetMs?: number;
  /** Plan expansions per call (the most urgent first; the rest wait for the next call). */
  maxPlans?: number;
  /** Supplement feed rows read per call. */
  maxSupplements?: number;
  /** Seconds a claim is held before another call may take it over. */
  leaseSeconds?: number;
  /** Runs after each claim, before its jobs are handled (tests: a change landing between a claim and its sends). */
  onClaimed?: (jobs: readonly ClaimedJob[]) => Promise<void> | void;
};

export type DispatchSummary = {
  now: string;
  planned: number;
  purged: number;
  /** Plans expanded by this call's planning, and whether some were left for the next call. */
  expanded: number;
  plansMore: boolean;
  /** Supplement feed rows read, and whether the window holds more for the next call. */
  supplementsRead: number;
  supplementsMore: boolean;
  claimed: number;
  sent: number;
  suppressed: Partial<Record<Suppression, number>>;
  retried: number;
  failed: number;
  gone: number;
  /** Outcomes not recorded because the lease had passed to another call. */
  lost: number;
  /** Jobs whose outcome could not be recorded (they come back when their lease expires). */
  errors: number;
  batches: number;
};

/** The limits of one call (every minute). */
export const DISPATCH_LIMITS = {
  batch: 25,
  /** The whole call; the route allows 60 s. */
  budgetMs: 40_000,
  /** Planning's share: sending always keeps at least budgetMs - planBudgetMs. */
  planBudgetMs: 10_000,
  /** Plan expansions per call (a plan is expanded only near a reminder moment or after a change). */
  maxPlans: 200,
  /** Supplement feed rows per call (pages of 500). */
  maxSupplements: 2000,
  leaseSeconds: 120,
} as const;

export async function dispatchReminders(options: DispatchOptions): Promise<DispatchSummary> {
  const { db, push } = options;
  const started = Date.now();
  const batchSize = options.batchSize ?? DISPATCH_LIMITS.batch;
  const budgetMs = options.budgetMs ?? DISPATCH_LIMITS.budgetMs;
  const planBudgetMs = Math.min(options.planBudgetMs ?? DISPATCH_LIMITS.planBudgetMs, Math.floor(budgetMs / 4));

  const planned = await db.rpc("plan_reminder_jobs", {
    ...(options.now ? { p_now: options.now.toISOString() } : {}),
    p_max_plans: options.maxPlans ?? DISPATCH_LIMITS.maxPlans,
    p_max_supplements: options.maxSupplements ?? DISPATCH_LIMITS.maxSupplements,
    p_budget_ms: Math.max(100, planBudgetMs),
  });
  if (planned.error) throw new Error(`Could not plan reminders: ${planned.error.message}`);
  const plan = planned.data as {
    now: string;
    planned: number;
    purged: number;
    expanded: number;
    plans_more: boolean;
    supplements_read: number;
    supplements_more: boolean;
  };
  const now = new Date(plan.now);

  const summary: DispatchSummary = {
    now: now.toISOString(),
    planned: plan.planned,
    purged: plan.purged,
    expanded: plan.expanded,
    plansMore: plan.plans_more,
    supplementsRead: plan.supplements_read,
    supplementsMore: plan.supplements_more,
    claimed: 0,
    sent: 0,
    suppressed: {},
    retried: 0,
    failed: 0,
    gone: 0,
    lost: 0,
    errors: 0,
    batches: 0,
  };
  const context = new Context(db, now);

  while (Date.now() - started < budgetMs) {
    const claimed = await db.rpc("claim_reminder_jobs", {
      p_now: now.toISOString(),
      p_limit: batchSize,
      p_lease_seconds: options.leaseSeconds ?? DISPATCH_LIMITS.leaseSeconds,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (claimed.error) throw new Error(`Could not claim reminders: ${claimed.error.message}`);
    const jobs = claimed.data ?? [];
    summary.batches += 1;
    summary.claimed += jobs.length;
    await options.onClaimed?.(jobs);
    // Every batch reads the owners' records afresh, after its claim.
    context.startBatch(jobs);
    // A job whose outcome could not be recorded stays claimed: its lease expires and a later call retries it.
    await Promise.all(
      jobs.map((job) =>
        handle(job, context, push, now, summary).catch((error: unknown) => {
          summary.errors += 1;
          console.error(`Reminder ${job.id} not recorded:`, error instanceof Error ? error.message : error);
        }),
      ),
    );
    if (jobs.length < batchSize) break;
  }
  return summary;
}

/** One claimed job: recheck, send, record. A failure here fails only this job (retried like a send). */
async function handle(job: ClaimedJob, context: Context, push: PushDeps, now: Date, summary: DispatchSummary): Promise<void> {
  const finish = async (outcome: "sent" | "suppressed" | "failed" | "gone" | "retry", result: string, statusCode?: number, retry?: Date | null) => {
    const { data, error } = await context.db.rpc("finish_reminder_job", {
      p_id: job.id,
      p_lease_token: job.lease_token,
      p_outcome: outcome,
      p_result: result,
      ...(statusCode !== undefined ? { p_status_code: statusCode } : {}),
      ...(retry ? { p_retry_at: retry.toISOString() } : {}),
      p_now: now.toISOString(),
    });
    if (error) throw new Error(`Could not record reminder ${job.id}: ${error.message}`);
    if (!data) summary.lost += 1;
    return data === true;
  };
  const suppress = async (reason: Suppression) => {
    if (await finish("suppressed", reason)) summary.suppressed[reason] = (summary.suppressed[reason] ?? 0) + 1;
  };
  const failOrRetry = async (error: string, statusCode?: number, transient = true) => {
    const retry = transient ? retryAt(job.attempts, job.send_at, now) : null;
    if (retry) {
      if (await finish("retry", error, statusCode, retry)) summary.retried += 1;
    } else if (await finish("failed", error, statusCode)) summary.failed += 1;
  };

  if (!job.owner_agreed) return suppress("terms outdated");
  if (!job.device_on) return suppress("device off");

  let prepared: Prepared;
  let device: Suppression | null;
  try {
    prepared = await context.prepare(job);
    // Right before sending: the schedule and setting it was judged on are
    // still current (else judged again on fresh records), and the device is
    // still the owner's, active, with the same endpoint and keys.
    if (prepared.verdict.send) prepared = await context.fresh(job, prepared);
    device = prepared.verdict.send ? await context.deviceCheck(job) : null;
  } catch (error) {
    return failOrRetry(`recheck failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
  }
  if (!prepared.verdict.send) return suppress(prepared.verdict.reason);
  if (device) return suppress(device);

  const tag = prepared.payload!.tag;
  let result: PushSendResult;
  try {
    result = await sendPush(
      { id: job.subscription_id, endpoint: job.endpoint, p256dh: job.p256dh, auth: job.auth },
      prepared.payload!,
      {
        ttlSeconds: reminderTtlSeconds(
          {
            source: job.source as ReminderSource,
            kind: job.kind as JobKind,
            sendAt: job.send_at,
            occurrenceAt: job.occurrence_at,
            stopAt: prepared.stopAt,
          },
          now,
        ),
        topic: reminderTopic(tag),
        urgency: "high",
      },
      push,
    );
  } catch (error) {
    // An invalid payload or option (a programming error): never sent, never retried.
    return failOrRetry(`not sent: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), undefined, false);
  }
  if (result.status === "sent") {
    if (await finish("sent", "", result.statusCode)) summary.sent += 1;
  } else if (result.status === "gone") {
    if (await finish("gone", "subscription gone", result.statusCode)) summary.gone += 1;
  } else {
    await failOrRetry(result.error, result.statusCode, isTransientFailure(result, UNKNOWN_ENDPOINT));
  }
}

type OwnerRecords = {
  cycles: CycleRecord[];
  byPlan: Map<string, { cycle: CycleRecord; occurrences: Occurrence[] }>;
  /** Occurrences of the plans still running: in their cycle's current revision, the cycle not ended (as Today's). */
  running: Occurrence[];
  /** Plan → peptide, for the running plans. */
  peptideOf: Map<string, string>;
  mixtures: Map<string, Mixture>;
  headsUp: HeadsUpMinutes;
  /** Each of the owner's plans' schedule_version, read BEFORE the records above (so a newer version means newer records). */
  versions: Map<string, number>;
  badge: number;
};

/** A job judged: whether it goes out, and what it would say. `plans`: the plans whose schedules it was judged on. */
type Prepared = { verdict: Verdict; payload?: PushPayload; stopAt?: string | null; plans?: string[] };

/**
 * What one dispatch call reads. The owners' records are read afresh for every
 * batch (after its claim), and checked again per job right before sending
 * (fresh); the library's names once per call.
 */
class Context {
  private owners = new Map<string, Promise<OwnerRecords>>();
  private peptides: Promise<Map<string, string>> | null = null;
  private supplements: Promise<{ due: Map<string, DueSupplement>; taken: Set<string> }> | null = null;

  constructor(
    readonly db: Db,
    private readonly now: Date,
  ) {}

  private owner(ownerId: string): Promise<OwnerRecords> {
    let records = this.owners.get(ownerId);
    if (!records) {
      records = this.readOwner(ownerId);
      this.owners.set(ownerId, records);
      // A failed read is retried by the next job (or call), not cached.
      records.catch(() => {
        if (this.owners.get(ownerId) === records) this.owners.delete(ownerId);
      });
    }
    return records;
  }

  /** The schedule versions of the owner's plans and their heads-up setting: the cheap "has anything changed" read. */
  private async stamps(ownerId: string) {
    const [plans, preferences] = await Promise.all([
      this.db.from("cycle_plans").select("id, schedule_version").eq("owner_id", ownerId),
      this.db.from("account_preferences").select("default_syringe, weight_unit, appearance, heads_up_minutes").eq("owner_id", ownerId).maybeSingle(),
    ]);
    if (plans.error) throw new Error(`Could not read schedule versions: ${plans.error.message}`);
    if (preferences.error) throw new Error(`Could not read preferences: ${preferences.error.message}`);
    return {
      versions: new Map((plans.data ?? []).map((row) => [row.id, row.schedule_version])),
      headsUp: resolvePreferences(preferences.data).headsUpMinutes,
    };
  }

  private async readOwner(ownerId: string): Promise<OwnerRecords> {
    // First the stamps, then the records: a change after the stamps shows as a newer stamp (fresh).
    const { versions, headsUp } = await this.stamps(ownerId);
    const [cycles, confirmations, mixtures] = await Promise.all([
      listCycles(this.db, ownerId),
      ownerConfirmations(this.db, ownerId),
      planMixtures(this.db, ownerId),
    ]);
    const byPlan = new Map<string, { cycle: CycleRecord; occurrences: Occurrence[] }>();
    const running: Occurrence[] = [];
    const peptideOf = new Map<string, string>();
    for (const cycle of cycles) {
      if (cycle.revisions.length === 0) continue;
      for (const [planId, occurrences] of planOccurrences(cycle.revisions, confirmations.get(cycle.id) ?? [])) {
        byPlan.set(planId, { cycle, occurrences });
      }
      const latest = cycle.revisions.at(-1)!;
      if (cycleStatus(latest, this.now) === "Ended") continue;
      for (const plan of latest.plans) {
        peptideOf.set(plan.planId, plan.peptideId);
        running.push(...(byPlan.get(plan.planId)?.occurrences ?? []));
      }
    }
    return { cycles, byPlan, running, peptideOf, mixtures, headsUp, versions, badge: pendingDoses(cycles, confirmations, this.now) };
  }

  private peptideNames(): Promise<Map<string, string>> {
    if (!this.peptides) {
      this.peptides = listCyclePeptides(this.db).then((list) => new Map(list.map((p) => [p.id, p.name])));
      this.peptides.catch(() => (this.peptides = null));
    }
    return this.peptides;
  }

  prepare(job: ClaimedJob): Promise<Prepared> {
    return job.source === "dose" ? this.dose(job) : job.source === "heads-up" ? this.headsUp(job) : this.supplement(job);
  }

  /**
   * Right before sending: when a plan the job was judged on has a newer
   * schedule_version (a dose logged, skipped or undone, an edit), or the
   * heads-up setting changed, since the owner's records were read, read them
   * again and judge the job again.
   */
  async fresh(job: ClaimedJob, prepared: Prepared): Promise<Prepared> {
    if (job.source === "supplement") return prepared;
    const ownerRead = this.owner(job.owner_id);
    const [records, stamps] = await Promise.all([ownerRead, this.stamps(job.owner_id)]);
    const changed =
      (prepared.plans ?? []).some((plan) => stamps.versions.get(plan) !== records.versions.get(plan)) ||
      (job.source === "heads-up" && stamps.headsUp !== records.headsUp);
    if (!changed) return prepared;
    // Read again (other jobs of this owner in the batch then share the new read).
    if (this.owners.get(job.owner_id) === ownerRead) this.owners.delete(job.owner_id);
    return this.prepare(job);
  }

  /**
   * The claimed subscription, read again right before sending: still active,
   * still the job owner's, not turned off for that owner, and still the same
   * endpoint and keys. Otherwise the reminder is not sent (the device changed
   * hands or was re-registered since the claim).
   */
  async deviceCheck(job: ClaimedJob): Promise<Suppression | null> {
    const { data, error } = await this.db
      .from("push_subscriptions")
      .select("profile_id, endpoint, p256dh, auth, disabled_at, device_id")
      .eq("id", job.subscription_id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the device: ${error.message}`);
    if (!data || data.disabled_at !== null || data.profile_id !== job.owner_id) return "device changed";
    if (data.endpoint !== job.endpoint || data.p256dh !== job.p256dh || data.auth !== job.auth) return "device changed";
    if (data.device_id) {
      const off = await this.db.from("push_device_off").select("device_id").eq("profile_id", job.owner_id).eq("device_id", data.device_id).maybeSingle();
      if (off.error) throw new Error(`Could not read the device: ${off.error.message}`);
      if (off.data) return "device off";
    }
    return null;
  }

  private async dose(job: ClaimedJob): Promise<Prepared> {
    const records = await this.owner(job.owner_id);
    const entry = records.byPlan.get(job.plan_id);
    const occurrence = entry?.occurrences.find((o) => o.key === job.occurrence_key);
    const latest = entry?.cycle.revisions.at(-1);
    const verdict = doseVerdict(
      { kind: job.kind as ReminderKind, occurrenceKey: job.occurrence_key, occurrenceAt: job.occurrence_at },
      occurrence,
      {
        inCurrentRevision: !!latest?.plans.some((plan) => plan.planId === job.plan_id),
        cycleEnded: !latest || cycleStatus(latest, this.now) === "Ended",
      },
      this.now,
    );
    if (!verdict.send || !occurrence || !entry) return { verdict };

    const peptideId = latest!.plans.find((plan) => plan.planId === job.plan_id)!.peptideId;
    const peptide = (await this.peptideNames()).get(peptideId) || "Unknown peptide";
    const text = doseReminderText(job.kind as ReminderKind, {
      ...this.doseFacts(records, occurrence, peptide),
      time: clock12(occurrence.localTime),
    });
    const payload: PushPayload = {
      ...text,
      url: doseReminderUrl(occurrence.key),
      tag: reminderTag("dose", occurrence.key),
      badge: records.badge,
    };
    return { verdict, payload, stopAt: occurrence.remindersStopAt, plans: [job.plan_id] };
  }

  /** A dose as Today shows it: its planned amount ("250 mcg") and, with a saved mix, its syringe units (units only). */
  private doseFacts(records: OwnerRecords, occurrence: Occurrence, peptide: string) {
    const mixture = records.mixtures.get(occurrence.planId) ?? null;
    const draw = drawDisplay(mixture?.setup ?? null, occurrence.doseMg);
    return { peptide, amount: massLabel(occurrence.doseMg), units: draw.kind === "units" ? draw.units : null };
  }

  /** The heads-up before a planned time: every open dose planned then, in Today's order. */
  private async headsUp(job: ClaimedJob): Promise<Prepared> {
    const records = await this.owner(job.owner_id);
    const headsUpJob = { occurrenceAt: job.occurrence_at, sendAt: job.send_at, leadMinutes: job.lead_minutes ?? 0 };
    const verdict = headsUpVerdict(headsUpJob, records.headsUp, records.running, this.now);
    const doses = headsUpDoses(headsUpJob, records.running);
    if (!verdict.send || doses.length === 0) return { verdict };
    const names = await this.peptideNames();
    const text = headsUpText({
      doses: doses.map((o) => this.doseFacts(records, o, names.get(records.peptideOf.get(o.planId) ?? "") || "Unknown peptide")),
      time: clock12(doses[0].localTime),
      lead: records.headsUp as Exclude<HeadsUpMinutes, 0>,
    });
    const payload: PushPayload = { ...text, url: headsUpUrl(doses), tag: headsUpTag(doses), badge: records.badge };
    // Judged on every running plan (a dose at that time may be logged, skipped or moved in any of them).
    return { verdict, payload, stopAt: job.occurrence_at, plans: [...records.peptideOf.keys()] };
  }

  /**
   * A new batch: the owners' records are read again (after its claim), and,
   * for its supplement jobs at once, their occurrences as the due feed has
   * them now (untaken, under each routine's current definition, tracking on,
   * owner on the current terms) and their Taken records.
   */
  startBatch(jobs: readonly ClaimedJob[]) {
    this.owners.clear();
    const supplements = jobs.filter((job) => job.source === "supplement");
    if (supplements.length === 0) return;
    const facts = (async () => {
      const times = supplements.map((job) => Date.parse(job.occurrence_at));
      const from = new Date(Math.min(...times)).toISOString();
      const to = new Date(Math.max(...times) + 1000).toISOString();
      const routineIds = [...new Set(supplements.map((job) => job.routine_id))];
      const [due, taken] = await Promise.all([
        listDueSupplements(this.db, from, to),
        this.db.from("supplement_taken").select("routine_id, occurrence_key").in("routine_id", routineIds),
      ]);
      if (taken.error) throw new Error(`Could not read supplement Taken records: ${taken.error.message}`);
      return {
        due: new Map(due.map((row) => [`${row.routineId}|${row.occurrenceKey}`, row])),
        taken: new Set((taken.data ?? []).map((row) => `${row.routine_id}|${row.occurrence_key}`)),
      };
    })();
    facts.catch(() => {}); // each job reports it
    this.supplements = facts;
  }

  private async supplement(job: ClaimedJob): Promise<Prepared> {
    if (!this.supplements) throw new Error("supplement facts not read");
    const facts = await this.supplements;
    const key = `${job.routine_id}|${job.occurrence_key}`;
    const current = facts.due.get(key) ?? null;
    const verdict = supplementVerdict(
      { occurrenceKey: job.occurrence_key, occurrenceAt: job.occurrence_at, sendAt: job.send_at },
      current,
      facts.taken.has(key),
      this.now,
    );
    if (!verdict.send || !current) return { verdict };
    const records = await this.owner(job.owner_id);
    // As Today shows a routine: "Vitamin D3", "2000 IU".
    const text = supplementReminderText({ supplement: current.name, amount: `${current.amount} ${current.unit}` });
    const payload: PushPayload = {
      ...text,
      url: SUPPLEMENT_REMINDER_URL,
      tag: reminderTag("supplement", job.occurrence_key),
      badge: records.badge,
    };
    return { verdict, payload, stopAt: null };
  }
}
