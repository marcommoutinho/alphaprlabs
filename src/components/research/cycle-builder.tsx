"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { useMemo, useState, useSyncExternalStore } from "react";
import { saveCycleAction } from "@/app/(private)/app/cycles/actions";
import { AppButton, Field } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { CyclePlanEditor } from "@/components/research/cycle-plan-editor";
import { builderTitle, ERRORS_HEADING, fromTemplateNote, HISTORY_NOTE, saveLabel, scopeNote } from "@/lib/cycles/display";
import type { PhaseLock } from "@/lib/cycles/revise";
import {
  CYCLE_LIMITS,
  type CycleForm,
  type CyclePeptide,
  type CyclePlanForm,
  DATES_ZONE,
  newPlan,
  shiftPlan,
  tomorrowIn,
} from "@/lib/cycles/rules";
import { isValidTimeZone } from "@/lib/schedule/zone";
import "@/styles/app/cycles.css";

const CYCLES = "/app/cycles";

// The device's IANA zone: the suggestion for a new cycle (plan D4). Read on
// the client only; the server renders without it.
const noSubscription = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
const noZone = () => "";

/** A phase date was edited (not a phase added or removed). */
const datesEdited = (before: CyclePlanForm, after: CyclePlanForm) =>
  before.phases.length === after.phases.length &&
  before.phases.some((phase, i) => phase.start !== after.phases[i].start || phase.end !== after.phases[i].end);

/**
 * R3 Cycle builder: a new cycle (custom, or a template's copy) or "Edit
 * future plan" for an existing one. The time zone is named and stored with
 * the cycle: a new cycle suggests the device's zone, an existing cycle keeps
 * its own (a phone in another zone never changes it silently).
 *
 * Default dates ("tomorrow", as the prototype) are tomorrow in the cycle's
 * time zone. When the zone changes, the peptides added here whose dates the
 * researcher hasn't edited move with it; edited dates stay as typed.
 */
export function CycleBuilder({
  initial,
  peptides,
  zones,
  now,
  templateName,
  hasHistory = false,
  locks = {},
  effective = {},
  started = [],
}: {
  /** New plans' dates are tomorrow in DATES_ZONE (new cycle) or the cycle's zone (edit). */
  initial: CycleForm;
  peptides: CyclePeptide[];
  /** IANA zone names for the select. */
  zones: string[];
  /** The server's "now" (ISO), for tomorrow in the chosen zone. */
  now: string;
  templateName?: string;
  /** The cycle has recorded doses (S12 supplies this). */
  hasHistory?: boolean;
  /** While editing: each stored phase's lock, each plan's effective date, and the plans that have started. */
  locks?: Record<string, PhaseLock>;
  effective?: Record<string, string>;
  started?: string[];
}) {
  const editing = initial.cycleId !== null;
  const [form, setForm] = useState<CycleForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [toAdd, setToAdd] = useState("");
  // Peptides (added here) whose dates the researcher edited, and the zone the others' dates are for.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [datedFor, setDatedFor] = useState(editing ? initial.timeZone : DATES_ZONE);
  const router = useRouter();
  const { pending, submit } = useSubmit(saveCycleAction);
  const device = useSyncExternalStore(noSubscription, deviceZone, noZone);
  const library = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide])), [peptides]);

  // A new cycle follows the device's zone until the researcher picks one.
  const timeZone = form.timeZone || (editing ? "" : device);
  const datesZone = isValidTimeZone(timeZone) ? timeZone : datedFor;
  if (datesZone !== datedFor) {
    // The zone changed (or the device's became known): move untouched default dates to its tomorrow.
    const days = Temporal.PlainDate.from(tomorrowIn(now, datedFor)).until(tomorrowIn(now, datesZone)).days;
    setDatedFor(datesZone);
    if (days !== 0) {
      const moves = (plan: CyclePlanForm) => plan.planId === null && !touched.has(plan.peptideId);
      setForm((current) => ({ ...current, plans: current.plans.map((plan) => (moves(plan) ? shiftPlan(plan, days) : plan)) }));
    }
  }
  const defaultStart = tomorrowIn(now, datesZone);
  const zoneOptions = useMemo(
    () => [...new Set([...zones, ...(timeZone ? [timeZone] : [])])].sort(),
    [zones, timeZone],
  );
  const addable = peptides.filter((peptide) => peptide.available && !form.plans.some((plan) => plan.peptideId === peptide.id));
  const selected = addable.some((peptide) => peptide.id === toAdd) ? toAdd : (addable[0]?.id ?? "");
  const update = (patch: Partial<CycleForm>) => setForm((current) => ({ ...current, ...patch }));

  function save(event: React.FormEvent) {
    event.preventDefault();
    submit({ ...form, timeZone }, (result) => {
      setErrors(result?.errors ?? []);
      if (result?.saved) router.push(CYCLES);
    });
  }

  return (
    <form noValidate onSubmit={save} className="app-cyc">
      <Link href={CYCLES} className="app-cyc-back">
        ‹ Cycles
      </Link>
      <h1 className="app-h1 app-cyc-title">{builderTitle(editing)}</h1>
      {templateName ? <p className="app-cyc-intro">{fromTemplateNote(templateName)}</p> : null}
      {hasHistory ? <p className="app-cyc-history">{HISTORY_NOTE}</p> : null}

      <div className="app-cyc-fields">
        <Field label="Cycle name">
          <input
            name="name"
            autoComplete="off"
            maxLength={CYCLE_LIMITS.name}
            placeholder="e.g. Recomp Spring 26"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>
        <Field label="Time zone">
          <select name="timeZone" value={timeZone} onChange={(e) => update({ timeZone: e.target.value })}>
            {timeZone ? null : <option value="">Choose a time zone</option>}
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Goal">
          <input
            name="goal"
            autoComplete="off"
            maxLength={CYCLE_LIMITS.goal}
            placeholder="What you're tracking toward"
            value={form.goal}
            onChange={(e) => update({ goal: e.target.value })}
          />
        </Field>
        <Field label="Starting baseline · optional">
          <input
            name="baseline"
            autoComplete="off"
            maxLength={CYCLE_LIMITS.baseline}
            placeholder="e.g. 82.4 kg · 6.1 h sleep"
            value={form.baseline}
            onChange={(e) => update({ baseline: e.target.value })}
          />
        </Field>
      </div>

      {form.plans.map((plan, index) => (
        <CyclePlanEditor
          key={plan.planId ?? plan.peptideId}
          name={library.get(plan.peptideId)?.name ?? "Unknown peptide"}
          withdrawn={library.get(plan.peptideId)?.available === false}
          plan={plan}
          locks={locks}
          from={plan.planId ? (effective[plan.planId] ?? null) : null}
          started={plan.planId !== null && started.includes(plan.planId)}
          defaultStart={defaultStart}
          onChange={(next) => {
            if (datesEdited(plan, next)) setTouched((current) => new Set(current).add(plan.peptideId));
            update({ plans: form.plans.map((p, j) => (j === index ? next : p)) });
          }}
          onRemove={() => update({ plans: form.plans.filter((_, j) => j !== index) })}
        />
      ))}

      <div className="app-cyc-add">
        <select aria-label="Peptide to add" value={selected} disabled={addable.length === 0} onChange={(e) => setToAdd(e.target.value)}>
          {addable.map((peptide) => (
            <option key={peptide.id} value={peptide.id}>
              {peptide.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="app-cyc-add-btn"
          disabled={!selected}
          onClick={() => {
            setTouched((current) => new Set([...current].filter((id) => id !== selected)));
            update({ plans: [...form.plans, newPlan(selected, defaultStart)] });
          }}
        >
          + Add peptide from library
        </button>
      </div>

      {errors.length ? (
        <div role="alert" className="app-cyc-errors">
          <b>{ERRORS_HEADING}</b>
          <ul>
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="app-cyc-actions">
        <AppButton type="submit" saving={pending}>
          {saveLabel(editing)}
        </AppButton>
        <AppButton variant="secondary" onClick={() => router.push(CYCLES)}>
          Discard
        </AppButton>
        <span className="app-cyc-scope">{scopeNote(editing)}</span>
      </div>
    </form>
  );
}
