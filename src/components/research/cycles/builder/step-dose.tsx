"use client";

import { Field, NumberInput } from "@/components/alpha/field";
import { SyringeNote, SyringeRuler } from "@/components/alpha/gauges";
import { NowBlock } from "@/components/alpha/now-block";
import { Segmented } from "@/components/alpha/segmented";
import { type MassUnit, mgFromUnit } from "@/lib/alpha/format";
import { syringeScale } from "@/lib/alpha/syringe-scale";
import { type BuilderPlan, exactSyringes, mixReading, withSyringe } from "@/lib/cycles/builder";
import type { SyringeCapacity } from "@/lib/calculator/calculator";
import { OnInkSegmented } from "./parts";

const SYRINGES = [
  { value: 100, label: "100" },
  { value: 50, label: "50" },
  { value: 30, label: "30" },
] as const;

const UNITS = [
  { value: "mcg", label: "mcg" },
  { value: "mg", label: "mg" },
] as const;

/**
 * R4b Dose and mix (one peptide): the dose per injection with its mcg | mg
 * toggle, the vial and the BAC water, and the calculator inside the builder:
 * the syringe reading on the Now block, with a note when it falls between
 * the chosen syringe's lines (and which size reads it exactly). The mix is
 * optional; it is saved with the cycle as the peptide's saved mixture.
 */
export function StepDose({
  plan,
  name,
  onDose,
  onUnit,
  onMix,
}: {
  plan: BuilderPlan;
  name: string;
  onDose: (dose: string) => void;
  onUnit: (unit: MassUnit) => void;
  onMix: (mix: BuilderPlan["mix"]) => void;
}) {
  const doseMg = mgFromUnit(plan.dose, plan.unit);
  const reading = mixReading(plan.mix, doseMg);
  const scale = reading ? syringeScale({ units: reading.units, unitsText: reading.display.units, capacity: plan.mix.syringe, lineSpacing: plan.mix.lineSpacing }) : null;
  const exact = reading && reading.onLine === false ? exactSyringes(plan.mix, doseMg) : [];

  return (
    <>
      <div className="px-5 pt-[18px] laptop:px-0">
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.025em]">{name}</h1>
        <p className="mt-1 text-[15px] text-ink-2">Dose per injection, and how you&apos;ll mix the vial.</p>
      </div>

      <Field label="Dose" className="mx-4 mt-4 laptop:mx-0">
        <NumberInput
          value={plan.dose}
          onChange={(e) => onDose((e.target as HTMLInputElement).value)}
          placeholder="0"
          className="h-[60px] border-2 border-ink"
          unit={<Segmented size="mini" mono value={plan.unit} onValueChange={onUnit} options={UNITS} aria-label="Dose unit" />}
        />
      </Field>

      <div className="mx-4 mt-3.5 grid grid-cols-2 gap-2.5 laptop:mx-0">
        <Field label="Vial">
          <NumberInput
            value={plan.mix.vialMg}
            onChange={(e) => onMix({ ...plan.mix, vialMg: (e.target as HTMLInputElement).value })}
            placeholder="10"
            unit="mg"
            className="h-[52px]"
          />
        </Field>
        <Field label="BAC water">
          <NumberInput
            value={plan.mix.liquidMl}
            onChange={(e) => onMix({ ...plan.mix, liquidMl: (e.target as HTMLInputElement).value })}
            placeholder="2"
            unit="mL"
            className="h-[52px]"
          />
        </Field>
      </div>

      <NowBlock aria-label="Each dose" className="mx-3 mt-[18px] rounded-[24px] px-[18px] pt-4 pb-3 laptop:mx-0" data-testid="dose-reading">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-on-ink-2">Each dose</span>
          <OnInkSegmented<SyringeCapacity>
            label="Syringe (units)"
            value={plan.mix.syringe}
            options={SYRINGES}
            onChange={(syringe) => onMix(withSyringe(plan.mix, syringe))}
          />
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[64px] leading-[0.85] font-semibold tracking-[-0.05em]" data-testid="dose-units">
              {reading ? reading.display.units : "—"}
            </span>
            <span className="font-mono text-[17px] text-on-ink-2">units</span>
          </div>
          {reading ? (
            <div className="text-right">
              <div className="font-mono text-base font-semibold">{reading.display.volume} mL</div>
              <div className="mt-0.5 text-[13px] text-on-ink-2">{reading.display.concentration} mg/mL</div>
            </div>
          ) : null}
        </div>
        {scale ? (
          <SyringeRuler onInk notes={false} units={reading!.units} unitsText={reading!.display.units} capacity={plan.mix.syringe} lineSpacing={plan.mix.lineSpacing} className="mt-3.5" />
        ) : (
          <p className="mt-3 text-[13px] text-on-ink-2">Enter the dose, the vial and the water to see where to draw to.</p>
        )}
      </NowBlock>

      {scale?.flags.map((flag) => (
        <SyringeNote
          key={flag.kind}
          flag={
            flag.kind === "between-lines" && exact.length
              ? { ...flag, message: `${flag.message} The ${exact[0]}-unit syringe reads it exactly.` }
              : flag
          }
          className="mx-5 mt-3 laptop:mx-0"
        />
      ))}
      <p className="mx-5 mt-3 text-[13px] leading-[18px] text-ink-3 laptop:mx-0">
        {plan.mix.mixtureId
          ? "This mix is saved for this peptide. A change is saved as its next version; doses already logged keep the one they used."
          : "Optional. Saved with the cycle as this peptide's mix, so Today can show the units to draw."}
      </p>
    </>
  );
}
