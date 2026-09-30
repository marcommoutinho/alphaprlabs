import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock12, massLabel } from "@/lib/alpha/format";
import { SYRINGE_LABEL } from "@/lib/calculator/calculator";
import type { CycleRecord } from "@/lib/cycles/rules";
import { cycleStatus, planOccurrences } from "@/lib/cycles/schedule";
import { listCyclePeptides, listCycles } from "@/lib/cycles/service";
import { drawDisplay, wallOf } from "@/lib/doses/rules";
import { ownerConfirmations } from "@/lib/doses/service";
import { pendingDoses } from "@/lib/doses/today";
import type { Mixture } from "@/lib/mixtures/rules";
import { planMixtures } from "@/lib/mixtures/service";
import { type PushDeps, type PushPayload, type PushSendResult, sendPush, UNKNOWN_ENDPOINT } from "@/lib/push/send";
import type { Occurrence } from "@/lib/schedule/engine";
import type { ReminderKind } from "@/lib/schedule/reminders";
import type { Database } from "@/lib/supabase/database.types";
import { SUPPLEMENT_TIME_ZONE } from "@/lib/supplements/rules";
import { listDueSupplements, type DueSupplement } from "@/lib/supplements/service";
import { doseReminderText, supplementReminderText } from "./copy";
import {
  doseReminderUrl,
  doseVerdict,
  isTransientFailure,
  MAX_ATTEMPTS,
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
//   1. plans the reminders due around now (plan_reminder_jobs, idempotent);
//   2. claims a bounded batch with a lease (claim_reminder_jobs: FOR UPDATE
//      SKIP LOCKED, so overlapping calls never share a job; an interrupted
//      call's jobs come back once their lease expires);
//   3. rechecks each job against the owner's current records (./rules
//      doseVerdict / supplementVerdict; the device and the terms come with
//      the claim) and suppresses what is no longer true;
//   4. sends the rest through sendPush with a TTL that ends with the
//      reminder's relevance, a topic and tag per occurrence (a follow-up
//      replaces the earlier reminder) and the app badge;
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
// Today's out-of-date notice when something changed since.

type Db = SupabaseClient<Database>;

type ClaimedJob = Database["public"]["Functions"]["claim_reminder_jobs"]["Returns"][number];

export type DispatchOptions = {
  /** The secret-key client (the queue functions are the service role's only). */
  db: Db;
  push: PushDeps;
  /** The clock (tests). Default: the database's now(). */
  now?: Date;
  /** Jobs per claim (≤ 100). */
  batchSize?: number;
  /** No new batch is claimed after this long (ms); the route's maxDuration is well above it. */
  budgetMs?: number;
  /** Seconds a claim is held before another call may take it over. */
  leaseSeconds?: number;
};

export type DispatchSummary = {
  now: string;
  planned: number;
  purged: number;
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

const DEFAULT_BATCH = 25;
const DEFAULT_BUDGET_MS = 40_000;
const DEFAULT_LEASE_SECONDS = 120;

export async function dispatchReminders(options: DispatchOptions): Promise<DispatchSummary> {
  const { db, push } = options;
  const started = Date.now();
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;

  const planned = await db.rpc("plan_reminder_jobs", options.now ? { p_now: options.now.toISOString() } : {});
  if (planned.error) throw new Error(`Could not plan reminders: ${planned.error.message}`);
  const plan = planned.data as { now: string; planned: number; purged: number };
  const now = new Date(plan.now);

  const summary: DispatchSummary = {
    now: now.toISOString(),
    planned: plan.planned,
    purged: plan.purged,
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
      p_lease_seconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (claimed.error) throw new Error(`Could not claim reminders: ${claimed.error.message}`);
    const jobs = claimed.data ?? [];
    summary.batches += 1;
    summary.claimed += jobs.length;
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

  let prepared: { verdict: Verdict; payload?: PushPayload; stopAt?: string | null };
  try {
    prepared = job.source === "dose" ? await context.dose(job) : await context.supplement(job);
  } catch (error) {
    return failOrRetry(`recheck failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
  }
  if (!prepared.verdict.send) return suppress(prepared.verdict.reason);

  const tag = prepared.payload!.tag;
  let result: PushSendResult;
  try {
    result = await sendPush(
      { id: job.subscription_id, endpoint: job.endpoint, p256dh: job.p256dh, auth: job.auth },
      prepared.payload!,
      {
        ttlSeconds: reminderTtlSeconds({ source: job.source as "dose" | "supplement", kind: job.kind as ReminderKind, sendAt: job.send_at, stopAt: prepared.stopAt }, now),
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
  mixtures: Map<string, Mixture>;
  badge: number;
};

/** What one dispatch call reads, once per owner (and the library and supplement feed once per call). */
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
      records = (async () => {
        const [cycles, confirmations, mixtures] = await Promise.all([
          listCycles(this.db, ownerId),
          ownerConfirmations(this.db, ownerId),
          planMixtures(this.db, ownerId),
        ]);
        const byPlan = new Map<string, { cycle: CycleRecord; occurrences: Occurrence[] }>();
        for (const cycle of cycles) {
          if (cycle.revisions.length === 0) continue;
          for (const [planId, occurrences] of planOccurrences(cycle.revisions, confirmations.get(cycle.id) ?? [])) {
            byPlan.set(planId, { cycle, occurrences });
          }
        }
        return { cycles, byPlan, mixtures, badge: pendingDoses(cycles, confirmations, this.now) };
      })();
      this.owners.set(ownerId, records);
      // A failed read is retried by the next job (or call), not cached.
      records.catch(() => this.owners.delete(ownerId));
    }
    return records;
  }

  private peptideNames(): Promise<Map<string, string>> {
    if (!this.peptides) {
      this.peptides = listCyclePeptides(this.db).then((list) => new Map(list.map((p) => [p.id, p.name])));
      this.peptides.catch(() => (this.peptides = null));
    }
    return this.peptides;
  }

  async dose(job: ClaimedJob) {
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
    const mixture = records.mixtures.get(job.plan_id) ?? null;
    const draw = drawDisplay(mixture?.setup ?? null, occurrence.doseMg);
    const text = doseReminderText(job.kind as ReminderKind, {
      peptide,
      amount: massLabel(occurrence.doseMg),
      time: clock12(occurrence.localTime),
      units: draw.kind === "units" ? draw.units : null,
      syringe: mixture && draw.kind === "units" ? SYRINGE_LABEL[mixture.setup.syringe] : null,
    });
    const payload: PushPayload = {
      ...text,
      url: doseReminderUrl(occurrence.key),
      tag: reminderTag("dose", occurrence.key),
      badge: records.badge,
    };
    return { verdict, payload, stopAt: occurrence.remindersStopAt };
  }

  /**
   * Reads, for a batch's supplement jobs at once, their occurrences as the
   * due feed has them now (untaken, under each routine's current definition,
   * tracking on, owner on the current terms) and their Taken records.
   */
  startBatch(jobs: readonly ClaimedJob[]) {
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

  async supplement(job: ClaimedJob) {
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
    const text = supplementReminderText({
      name: current.name,
      amount: current.amount,
      unit: current.unit,
      time: clock12(wallOf(current.scheduledAt, SUPPLEMENT_TIME_ZONE).slice(11)),
    });
    const payload: PushPayload = {
      ...text,
      url: SUPPLEMENT_REMINDER_URL,
      tag: reminderTag("supplement", job.occurrence_key),
      badge: records.badge,
    };
    return { verdict, payload, stopAt: null };
  }
}
