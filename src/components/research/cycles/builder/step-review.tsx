"use client";

import { Field, TextInput } from "@/components/alpha/field";
import { clock12, massLabel, mgFromUnit, shortDate } from "@/lib/alpha/format";
import { isPositiveDecimal } from "@/lib/calculator/decimal";
import { type BuilderState, mixReading, phaseNames, previewPhases } from "@/lib/cycles/builder";
import { daysLabel, laneBars, plusDays } from "@/lib/cycles/geometry";
import { CYCLE_LIMITS } from "@/lib/cycles/rules";
import { isLocalDate } from "@/lib/schedule/zone";
import { CardLane } from "../lanes";

const whole = (text: string): number | null => (/^\s*\d{1,5}\s*$/.test(text) ? Number(text.trim()) : null);

/**
 * The review after R4c: every peptide's lane and phases on one screen, the
 * cycle's name, goal (results are reviewed against it), an optional
 * baseline and the time zone it follows, then Start cycle.
 */
export function StepReview({
  state,
  timeZone,
  zones,
  totalDays,
  nameOf,
  onChange,
}: {
  state: BuilderState;
  timeZone: string;
  zones: readonly string[];
  totalDays: number;
  nameOf: (peptideId: string) => string;
  onChange: (patch: Partial<Pick<BuilderState, "name" | "goal" | "baseline" | "timeZone">>) => void;
}) {
  const total = Math.max(1, totalDays);
  const end = isLocalDate(state.start) && totalDays > 0 ? plusDays(state.start, totalDays - 1) : null;
  return (
    <>
      <div className="px-5 pt-[22px] laptop:px-0">
        <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.025em]">Review</h1>
        <p className="mt-1.5 font-mono text-[13px] font-medium text-ink-3" data-testid="review-span">
          {isLocalDate(state.start) ? shortDate(state.start) : "No start date"}
          {end ? ` – ${shortDate(end)} · ${totalDays} ${totalDays === 1 ? "day" : "days"}` : ""}
        </p>
      </div>

      <div className="mx-4 mt-4 flex flex-col gap-3.5 laptop:mx-0">
        <Field label="Cycle name">
          <TextInput name="name" autoComplete="off" maxLength={CYCLE_LIMITS.name} placeholder="e.g. Recovery protocol" value={state.name} onChange={(e) => onChange({ name: (e.target as HTMLInputElement).value })} />
        </Field>
        <Field label="Goal" description="Results are reviewed against it.">
          <TextInput name="goal" autoComplete="off" maxLength={CYCLE_LIMITS.goal} placeholder="What you're tracking toward" value={state.goal} onChange={(e) => onChange({ goal: (e.target as HTMLInputElement).value })} />
        </Field>
        <Field label="Starting baseline" optional>
          <TextInput name="baseline" autoComplete="off" maxLength={CYCLE_LIMITS.baseline} placeholder="e.g. 82.4 kg · 6.1 h sleep" value={state.baseline} onChange={(e) => onChange({ baseline: (e.target as HTMLInputElement).value })} />
        </Field>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">Time zone</span>
          <select
            name="timeZone"
            aria-label="Time zone"
            value={timeZone}
            onChange={(e) => onChange({ timeZone: e.target.value })}
            className="h-[52px] w-full rounded-[14px] border border-line bg-surface px-3.5 text-base text-ink"
          >
            {timeZone ? null : <option value="">Choose a time zone</option>}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <span className="text-[13px] text-ink-3">Doses follow this zone&apos;s clock, wherever your phone is.</span>
        </label>
      </div>

      <section aria-label="Peptides" className="mt-6">
        <h2 className="mb-2 px-5 text-[13px] font-semibold text-ink-2 laptop:px-0">Peptides · {state.plans.length}</h2>
        <div className="mx-3 flex flex-col gap-2.5 laptop:mx-0">
          {state.plans.map((plan) => {
            const bars = laneBars(previewPhases(plan, state.start), state.start, total);
            const names = phaseNames(plan.phases);
            const doseMg = mgFromUnit(plan.dose, plan.unit);
            const reading = mixReading(plan.mix, doseMg);
            return (
              <article key={plan.planId ?? plan.peptideId} className="rounded-[24px] border border-line bg-surface p-4" data-testid="review-plan">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[18px] font-semibold">{nameOf(plan.peptideId)}</h3>
                  {reading ? (
                    <span className="font-mono text-[13px] font-medium text-ink-2">
                      {reading.display.units} units · {plan.mix.syringe}-unit
                    </span>
                  ) : (
                    <span className="text-[13px] text-ink-3">No mix</span>
                  )}
                </div>
                <CardLane bars={bars} todayPercent={null} height={16} className="mt-3" />
                <ol className="mt-3 flex flex-col text-[14px]">
                  {plan.phases.map((phase, i) => {
                    const [day, length] = [whole(phase.day), whole(phase.length)];
                    const mg = mgFromUnit(phase.dose, plan.unit);
                    return (
                      <li key={phase.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 border-t border-line py-2">
                        <span className="min-w-0">
                          <span className="font-semibold">{names[i]}</span>
                          <span className="font-mono text-[13px] text-ink-3"> · {day !== null && length !== null ? daysLabel(day, day + length - 1) : "days not set"}</span>
                        </span>
                        <span className={phase.kind === "break" ? "text-ink-2" : "font-semibold"}>
                          {phase.kind === "break"
                            ? `${length ?? "?"} days off`
                            : `${isPositiveDecimal(mg) ? massLabel(mg) : "No dose"} · ${clock12(phase.time)}`}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
