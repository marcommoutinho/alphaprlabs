"use client";

import { ChevronDown } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { deleteMixtureAction, saveMixtureAction } from "@/app/(private)/app/calculator/actions";
import { BackBar } from "@/components/alpha/back-bar";
import { Button } from "@/components/alpha/button";
import { Checkbox, Field, NumberInput } from "@/components/alpha/field";
import { Segmented } from "@/components/alpha/segmented";
import { useAlphaToast } from "@/components/alpha/toast";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";
import { CalculatorErrors, CalculatorResultView } from "@/components/research/calculator-result";
import { SavedMixtures } from "@/components/research/saved-mixtures";
import { SAVE_FAILED_MESSAGE, type ToastTone } from "@/lib/app/save";
import { calculate, lineSpacingNote, SYRINGE_CAPACITIES, SYRINGE_LABEL, type SyringeCapacity } from "@/lib/calculator/calculator";
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
import { cn } from "@/lib/utils";

/** A native select in the field frame (§7.2): 52 px, radius 14, `surface`, 1 px `line`, a chevron. */
function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "h-[52px] w-full cursor-pointer appearance-none truncate rounded-[14px] border border-line bg-surface pr-10 pl-3.5 text-base text-ink",
          "focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)] focus-visible:outline-none",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
    </div>
  );
}

/** A label above a native select: 13/600 `ink-2`, 6 px gap (§7.2). */
function SelectField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
    </label>
  );
}

type Answer = { errors?: string[]; toast?: string; tone?: ToastTone; mixtureId?: string };

/**
 * R7 Calculator (design v3): the fields on the left, the live result (the
 * screen's Now block: the draw on the syringe's real lines), Save mixture with
 * the cycle plans it serves, and the saved mixtures on the right. One column
 * on a phone. Nothing is rounded; the calculator never chooses a dose.
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
  const toast = useAlphaToast();
  const [form, setForm] = useState<CalculatorForm>(initial);
  const [linked, setLinked] = useState<ReadonlySet<string>>(new Set(initialLinked));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, startSave] = useTransition();
  const [removing, startRemove] = useTransition();
  const ids = useId();

  const names = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide.name])), [peptides]);
  const nameOf = (id: string) => names.get(id) ?? "Unknown peptide";
  const loaded = mixtures.find((mixture) => mixture.id === form.mixtureId) ?? null;
  const planPeptides = new Set(plans.map((plan) => plan.peptideId));
  const peptideOptions = peptides.filter((p) => p.available || planPeptides.has(p.id) || p.id === form.peptideId);
  const offered = plansFor(plans, form.peptideId, form.mixtureId);
  const spacing = spacingOf(form.syringe, form.lineChoice);
  const result = calculate(formInput(form));
  const update = (patch: Partial<CalculatorForm>) => setForm((current) => ({ ...current, ...patch }));

  /** An action's toast: "info" is a success; a warning or an error stays until dismissed. */
  const notify = (message: string, tone: ToastTone = "error") => (tone === "info" ? toast.success({ message }) : toast.error({ message }));

  /** Calls a save or delete; a redirect (the session ended) goes to Next.js, a failed request keeps the entry. */
  const run = (start: typeof startSave, call: () => Promise<Answer>, then: (answer: Answer) => void) =>
    start(async () => {
      let answer: Answer;
      try {
        answer = await call();
      } catch (error) {
        unstable_rethrow(error);
        notify(SAVE_FAILED_MESSAGE);
        return;
      }
      if (answer.toast) notify(answer.toast, answer.tone);
      then(answer);
    });

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
    run(
      startSave,
      () =>
        saveMixtureAction({
          mixtureId: loaded ? loaded.id : null,
          version: loaded ? loaded.version : null,
          peptideId: form.peptideId,
          vialMg: form.vialMg,
          liquidMl: form.liquidMl,
          syringe: form.syringe,
          lineSpacing: spacing,
          planIds,
        }),
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
    run(
      startRemove,
      () => deleteMixtureAction({ id: mixture.id, version: mixture.version }),
      () => {
        if (form.mixtureId === mixture.id) update({ mixtureId: "" });
        router.refresh();
      },
    );
  }

  return (
    <main className={CYCLES_MAIN}>
      <BackBar href="/app/cycles" label="Cycles" />
      <div className="grid gap-7 px-3 laptop:grid-cols-[minmax(0,440px)_minmax(0,1fr)] laptop:gap-8 laptop:px-0">
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="px-2 text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:px-0">Calculator</h1>
          <SelectField label="Saved mixture">
            <Select value={form.mixtureId} onChange={(e) => load(mixtures.find((m) => m.id === e.target.value) ?? null)}>
              <option value="">New mixture</option>
              {mixtures.map((mixture) => (
                <option key={mixture.id} value={mixture.id}>
                  {mixtureLabel(nameOf(mixture.peptideId), mixture.setup)}
                </option>
              ))}
            </Select>
          </SelectField>
          <SelectField label="Peptide">
            <Select value={form.peptideId} onChange={(e) => choosePeptide(e.target.value)}>
              {form.peptideId === "" ? <option value="">Choose a peptide</option> : null}
              {peptideOptions.map((peptide) => (
                <option key={peptide.id} value={peptide.id}>
                  {peptide.name}
                </option>
              ))}
            </Select>
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vial strength (mg per vial)">
              <NumberInput unit="mg" value={form.vialMg} onChange={(e) => update({ vialMg: e.target.value })} />
            </Field>
            <Field label="Liquid added (mL)">
              <NumberInput unit="mL" value={form.liquidMl} onChange={(e) => update({ liquidMl: e.target.value })} />
            </Field>
          </div>
          <Field label="Intended dose (mg) · entered by you">
            <NumberInput unit="mg" value={form.doseMg} onChange={(e) => update({ doseMg: e.target.value })} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id={`${ids}-syringe`} className="text-[13px] font-semibold text-ink-2">
              Syringe size · U-100
            </span>
            <Segmented<`${SyringeCapacity}`>
              aria-labelledby={`${ids}-syringe`}
              value={`${form.syringe}`}
              onValueChange={(value) => update({ syringe: Number(value) as SyringeCapacity })}
              options={SYRINGE_CAPACITIES.map((capacity) => ({
                value: `${capacity}` as const,
                label: (
                  <span className="flex items-baseline gap-1.5">
                    {SYRINGE_LABEL[capacity]}{" "}
                    <span className="font-mono text-[12px] font-normal text-ink-3">{capacity}-unit</span>
                  </span>
                ),
              }))}
            />
          </div>
          <div className="flex flex-col gap-2 laptop:flex-row laptop:items-center laptop:justify-between">
            <span className="px-2 text-[13px] leading-[18px] text-ink-2 laptop:px-0">{lineSpacingNote(form.syringe, spacing)}</span>
            <Select
              aria-label="Line spacing override"
              className="laptop:w-[230px]"
              value={form.lineChoice}
              onChange={(e) => update({ lineChoice: e.target.value as LineChoice })}
            >
              {LINE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="px-2 text-[13px] leading-[18px] text-ink-3 laptop:px-0">{CALCULATOR_NOTE}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4 laptop:pt-[52px]">
          {!result.ok ? <CalculatorErrors errors={result.errors} /> : null}
          {result.ok ? (
            <>
              <CalculatorResultView result={result} syringe={form.syringe} spacing={spacing} />
              <fieldset className="min-w-0">
                <legend className="mb-2 px-2 text-[13px] font-semibold text-ink-2 laptop:px-0">{LINK_HEADING}</legend>
                {offered.length === 0 ? <p className="px-2 text-[15px] leading-5 text-ink-2 laptop:px-0">{NO_PLANS}</p> : null}
                <div className={cn("divide-y divide-line rounded-group border border-line bg-surface px-4", offered.length === 0 && "hidden")}>
                  {offered.map((plan) => {
                    const other = plan.mixtureId && plan.mixtureId !== form.mixtureId ? mixtures.find((m) => m.id === plan.mixtureId) : undefined;
                    const labelId = `${ids}-plan-${plan.planId}`;
                    return (
                      <label key={plan.planId} className="flex min-h-14 cursor-pointer items-center gap-3 py-2">
                        <Checkbox checked={linked.has(plan.planId)} onCheckedChange={(on) => toggle(plan.planId, on)} aria-labelledby={labelId} />
                        <span id={labelId} className="min-w-0 flex-1 text-[15px] leading-5">
                          <span className="font-semibold">{plan.cycleName}</span>
                          <span className="text-ink-2">
                            {" "}
                            · {plan.status}
                            {other ? ` · now uses ${other.setup.vialMg} mg / ${other.setup.liquidMl} mL` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {errors.length ? (
                <div role="alert" className="rounded-group bg-missed-tint px-4 py-3 text-[14px] leading-5 font-medium text-missed">
                  {errors.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-col gap-2 laptop:flex-row laptop:items-center laptop:gap-4">
                <Button variant="primary" size="lg" className="laptop:h-12 laptop:shrink-0" saving={saving} onClick={saveMixture}>
                  {saveLabel(loaded !== null)}
                </Button>
                <span className="px-2 text-[13px] leading-[18px] text-ink-3 laptop:px-0">{SAVE_NOTE}</span>
              </div>
            </>
          ) : null}
          <SavedMixtures
            mixtures={mixtures}
            plans={plans}
            trackedVials={trackedVials}
            nameOf={nameOf}
            busy={removing}
            onLoad={load}
            onDelete={deleteMixture}
          />
        </div>
      </div>
    </main>
  );
}
