"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { deleteMixtureAction, saveMixtureAction } from "@/app/(private)/app/calculator/actions";
import { AppButton, Field } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import { CalculatorErrors, CalculatorResultView } from "@/components/research/calculator-result";
import { SavedMixtures } from "@/components/research/saved-mixtures";
import { calculate, lineSpacingNote, SYRINGE_CAPACITIES, SYRINGE_LABEL } from "@/lib/calculator/calculator";
import type { CyclePeptide } from "@/lib/cycles/rules";
import { type LinkablePlan, plansFor } from "@/lib/mixtures/plans";
import {
  CALCULATOR_NOTE,
  type CalculatorForm,
  formFromMixture,
  formInput,
  LINE_CHOICES,
  type LineChoice,
  LINK_HEADING,
  type Mixture,
  mixtureLabel,
  NO_PLANS,
  SAVE_NOTE,
  saveLabel,
  spacingOf,
} from "@/lib/mixtures/rules";

/**
 * R7 Calculator (the prototype's calculator screen): the fields on the left,
 * the live result, Save mixture with the cycle plans it serves, and the saved
 * mixtures on the right. One column on phone.
 */
export function Calculator({
  initial,
  initialLinked,
  peptides,
  mixtures,
  plans,
  trackedVials,
}: {
  initial: CalculatorForm;
  /** Plans ticked at first: the opened mixture's, or the opened plan. */
  initialLinked: string[];
  peptides: CyclePeptide[];
  mixtures: Mixture[];
  plans: LinkablePlan[];
  trackedVials: Record<string, string>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CalculatorForm>(initial);
  const [linked, setLinked] = useState<ReadonlySet<string>>(new Set(initialLinked));
  const [errors, setErrors] = useState<string[]>([]);
  const save = useSubmit(saveMixtureAction);
  const remove = useSubmit(deleteMixtureAction);

  const names = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide.name])), [peptides]);
  const nameOf = (id: string) => names.get(id) ?? "Unknown peptide";
  const loaded = mixtures.find((mixture) => mixture.id === form.mixtureId) ?? null;
  const planPeptides = new Set(plans.map((plan) => plan.peptideId));
  const peptideOptions = peptides.filter((p) => p.available || planPeptides.has(p.id) || p.id === form.peptideId);
  const offered = plansFor(plans, form.peptideId, form.mixtureId);
  const spacing = spacingOf(form.syringe, form.lineChoice);
  const result = calculate(formInput(form));
  const update = (patch: Partial<CalculatorForm>) => setForm((current) => ({ ...current, ...patch }));

  function load(mixture: Mixture | null) {
    setErrors([]);
    if (!mixture) {
      // "New mixture": keep the values typed; nothing is linked yet.
      update({ mixtureId: "" });
      setLinked(new Set());
      return;
    }
    setForm((current) => formFromMixture(mixture, current.doseMg));
    setLinked(new Set(mixture.planIds));
  }

  function choosePeptide(peptideId: string) {
    // A saved mixture keeps its peptide: another peptide is a new mixture.
    update({ peptideId, ...(loaded && loaded.peptideId !== peptideId ? { mixtureId: "" } : {}) });
    setLinked(new Set());
  }

  function toggle(planId: string, on: boolean) {
    setLinked((current) => {
      const next = new Set(current);
      if (on) next.add(planId);
      else next.delete(planId);
      return next;
    });
  }

  function saveMixture() {
    const planIds = offered.filter((plan) => linked.has(plan.planId)).map((plan) => plan.planId);
    save.submit(
      {
        mixtureId: loaded ? loaded.id : null,
        version: loaded ? loaded.version : null,
        peptideId: form.peptideId,
        vialMg: form.vialMg,
        liquidMl: form.liquidMl,
        syringe: form.syringe,
        lineSpacing: spacing,
        planIds,
      },
      (answer) => {
        setErrors(answer.errors ?? []);
        if (answer.mixtureId) {
          update({ mixtureId: answer.mixtureId });
          router.refresh();
        }
      },
    );
  }

  function deleteMixture(mixture: Mixture) {
    remove.submit({ id: mixture.id, version: mixture.version }, () => {
      if (form.mixtureId === mixture.id) update({ mixtureId: "" });
      router.refresh();
    });
  }

  return (
    <div className="app-calc">
      <div className="app-calc-inputs">
        <h1 className="app-h1">Calculator</h1>
        <Field label="Saved mixture">
          <select value={form.mixtureId} onChange={(e) => load(mixtures.find((m) => m.id === e.target.value) ?? null)}>
            <option value="">New mixture</option>
            {mixtures.map((mixture) => (
              <option key={mixture.id} value={mixture.id}>
                {mixtureLabel(nameOf(mixture.peptideId), mixture.setup)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Peptide">
          <select value={form.peptideId} onChange={(e) => choosePeptide(e.target.value)}>
            {form.peptideId === "" ? <option value="">Choose a peptide</option> : null}
            {peptideOptions.map((peptide) => (
              <option key={peptide.id} value={peptide.id}>
                {peptide.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="app-calc-pair">
          <Field label="Vial strength (mg per vial)">
            <input inputMode="decimal" autoComplete="off" value={form.vialMg} onChange={(e) => update({ vialMg: e.target.value })} />
          </Field>
          <Field label="Liquid added (mL)">
            <input inputMode="decimal" autoComplete="off" value={form.liquidMl} onChange={(e) => update({ liquidMl: e.target.value })} />
          </Field>
        </div>
        <label className="app-field">
          <span className="app-field-label app-calc-dose-label">Intended dose (mg) · entered by you</span>
          <input
            className="app-calc-dose"
            inputMode="decimal"
            autoComplete="off"
            value={form.doseMg}
            onChange={(e) => update({ doseMg: e.target.value })}
          />
        </label>
        <div>
          <div className="app-field-label">Syringe size · U-100</div>
          <div className="app-calc-syringes">
            {SYRINGE_CAPACITIES.map((capacity) => (
              <button
                key={capacity}
                type="button"
                aria-pressed={form.syringe === capacity}
                className="app-calc-syringe-btn"
                onClick={() => update({ syringe: capacity })}
              >
                {SYRINGE_LABEL[capacity]} <span>{capacity} u</span>
              </button>
            ))}
          </div>
        </div>
        <div className="app-calc-lines">
          <span>{lineSpacingNote(form.syringe, spacing)}</span>
          <select
            aria-label="Line spacing override"
            value={form.lineChoice}
            onChange={(e) => update({ lineChoice: e.target.value as LineChoice })}
          >
            {LINE_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        <p className="app-calc-note">{CALCULATOR_NOTE}</p>
      </div>

      <div className="app-calc-output">
        {!result.ok ? <CalculatorErrors errors={result.errors} /> : null}
        {result.ok ? (
          <>
            <CalculatorResultView result={result} syringe={form.syringe} spacing={spacing} />
            <fieldset className="app-calc-links">
              <legend>{LINK_HEADING}</legend>
              {offered.length === 0 ? <p className="app-calc-none">{NO_PLANS}</p> : null}
              {offered.map((plan) => {
                const other = plan.mixtureId && plan.mixtureId !== form.mixtureId ? mixtures.find((m) => m.id === plan.mixtureId) : undefined;
                return (
                  <label key={plan.planId} className="app-calc-plan">
                    <input type="checkbox" checked={linked.has(plan.planId)} onChange={(e) => toggle(plan.planId, e.target.checked)} />
                    <span>
                      {plan.cycleName}
                      <span className="app-calc-plan-meta">
                        {" "}
                        · {plan.status}
                        {other ? ` · now uses ${other.setup.vialMg} mg / ${other.setup.liquidMl} mL` : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {errors.length ? (
              <div role="alert" className="app-calc-save-errors">
                {errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}
            <div className="app-calc-save">
              <AppButton size="sm" className="app-calc-save-btn" saving={save.pending} onClick={saveMixture}>
                {saveLabel(loaded !== null)}
              </AppButton>
              <span>{SAVE_NOTE}</span>
            </div>
          </>
        ) : null}
        <SavedMixtures
          mixtures={mixtures}
          plans={plans}
          trackedVials={trackedVials}
          nameOf={nameOf}
          busy={remove.pending}
          onLoad={load}
          onDelete={deleteMixture}
        />
      </div>
    </div>
  );
}
