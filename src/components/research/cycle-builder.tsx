"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { saveCycleAction } from "@/app/(private)/app/cycles/actions";
import { AppButton, Field } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { CyclePlanEditor } from "@/components/research/cycle-plan-editor";
import { builderTitle, ERRORS_HEADING, fromTemplateNote, HISTORY_NOTE, saveLabel, scopeNote } from "@/lib/cycles/display";
import type { PhaseLock } from "@/lib/cycles/revise";
import { CYCLE_LIMITS, type CycleForm, type CyclePeptide, newPlan } from "@/lib/cycles/rules";
import "@/styles/app/cycles.css";

const CYCLES = "/app/cycles";

// The device's IANA zone: the suggestion for a new cycle (plan D4). Read on
// the client only; the server renders without it.
const noSubscription = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
const noZone = () => "";

/**
 * R3 Cycle builder: a new cycle (custom, or a template's copy) or "Edit
 * future plan" for an existing one. The time zone is named and stored with
 * the cycle: a new cycle suggests the device's zone, an existing cycle keeps
 * its own (a phone in another zone never changes it silently).
 */
export function CycleBuilder({
  initial,
  peptides,
  zones,
  defaultStart,
  templateName,
  hasHistory = false,
  locks = {},
  effective = {},
}: {
  initial: CycleForm;
  peptides: CyclePeptide[];
  /** IANA zone names for the select. */
  zones: string[];
  /** Where a new peptide's first phase starts (tomorrow). */
  defaultStart: string;
  templateName?: string;
  /** The cycle has recorded doses (S12 supplies this). */
  hasHistory?: boolean;
  /** While editing: each stored phase's lock, and each plan's effective date. */
  locks?: Record<string, PhaseLock>;
  effective?: Record<string, string>;
}) {
  const editing = initial.cycleId !== null;
  const [form, setForm] = useState<CycleForm>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [toAdd, setToAdd] = useState("");
  const router = useRouter();
  const { pending, submit } = useSubmit(saveCycleAction);
  const device = useSyncExternalStore(noSubscription, deviceZone, noZone);
  const library = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide])), [peptides]);

  // A new cycle follows the device's zone until the researcher picks one.
  const timeZone = form.timeZone || (editing ? "" : device);
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
          plan={plan}
          locks={locks}
          from={plan.planId ? (effective[plan.planId] ?? null) : null}
          defaultStart={defaultStart}
          onChange={(next) => update({ plans: form.plans.map((p, j) => (j === index ? next : p)) })}
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
          onClick={() => update({ plans: [...form.plans, newPlan(selected, defaultStart)] })}
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
