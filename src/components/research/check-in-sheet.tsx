"use client";

import { unstable_rethrow } from "next/navigation";
import { Check, ChevronDown, Info, Plus } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { saveCheckInAction } from "@/app/(private)/app/progress/actions";
import { Button } from "@/components/alpha/button";
import { ChipGroup } from "@/components/alpha/chip";
import { Field, NumberInput, TextArea, TextInput } from "@/components/alpha/field";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { useAlphaToast } from "@/components/alpha/toast";
import { SAVE_FAILED_MESSAGE } from "@/lib/app/save";
import { CHECK_IN_SAVED, type Effect, EFFECTS, FEELING_WORDS, FEELINGS, MEASUREMENTS, type MeasurementName, OTHER, toggleEffect, unitFor as suggestedUnit } from "@/lib/progress/rules";
import type { FormStart } from "@/lib/progress/screen";
import { DEFAULT_PREFERENCES, type WeightUnit } from "@/lib/preferences/rules";
import { cn } from "@/lib/utils";

export type CheckInContext = {
  /** Today's check-in day (America/Toronto, YYYY-MM-DD) and "Thu, Sep 24". */
  day: string;
  dayLabel: string;
  /** Each measurement's last value, by name ("Last: 180.1 lb · Mon Sep 21"). */
  last: Record<string, { value: string; unit: string; day: string }>;
  /** R8's weight unit: a new weight is entered in it (and stored with it). The default (lb) when not given. */
  weightUnit?: WeightUnit;
};

/**
 * R6 Daily check-in (a sheet; a drawer on a laptop): the overall feeling
 * (required), unwanted effects (R6's chips: "None" clears the others;
 * "+ Other" asks for its text), one
 * optional measurement and a note. One per America/Toronto day, for today
 * only: save_check_in re-checks the day. Opened from Today's card with the
 * tapped feeling preselected, or from Progress (R5), where today's saved
 * check-in opens as it is (`start`) and saves from the version shown, so a
 * change made on another device is never overwritten (CHECK_IN_CHANGED).
 */
export function CheckInSheet({
  open,
  feeling,
  start = null,
  context,
  onClose,
}: {
  open: boolean;
  /** The feeling tapped on the card. */
  feeling: number | null;
  /** Today's saved check-in, to edit; null to create it. */
  start?: FormStart | null;
  context: CheckInContext;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      {open ? (
        <CheckInBody key={`${context.day}/${feeling}/${start?.version ?? 0}`} initialFeeling={feeling} start={start} context={context} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

const MEASUREMENT_NAMES: readonly string[] = MEASUREMENTS.map((m) => m.name);

function CheckInBody({
  initialFeeling,
  start,
  context,
  onClose,
}: {
  initialFeeling: number | null;
  start: FormStart | null;
  context: CheckInContext;
  onClose: () => void;
}) {
  const toast = useAlphaToast();
  const unitFor = (name: string) => (name === "Weight" ? (context.weightUnit ?? DEFAULT_PREFERENCES.weightUnit) : suggestedUnit(name));
  const startName = (start?.measurement && MEASUREMENT_NAMES.includes(start.measurement.name) ? start.measurement.name : "Weight") as MeasurementName;
  const [feeling, setFeelingValue] = useState<number>(start?.feeling ?? initialFeeling ?? 0);
  const [effects, setEffectsValue] = useState<Effect[]>(start?.effects ?? []);
  const [other, setOtherValue] = useState(start?.effectsOther ?? "");
  const otherRef = useRef<HTMLInputElement>(null);
  const [measurementName, setNameValue] = useState<MeasurementName>(startName);
  const [measurementValue, setValueValue] = useState(start?.measurement?.value ?? "");
  const [measurementUnit, setUnitValue] = useState<string>(start?.measurement?.unit ?? unitFor(startName));
  const [note, setNoteValue] = useState(start?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setError(null);
      set(value);
    };
  const [setFeeling, setEffects, setOther, setValue, setUnit, setNote] = [
    edited(setFeelingValue),
    edited(setEffectsValue),
    edited(setOtherValue),
    edited(setValueValue),
    edited(setUnitValue),
    edited(setNoteValue),
  ];
  const last = context.last[measurementName];

  const save = () => {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await saveCheckInAction({
          day: context.day,
          version: start?.version ?? null,
          feeling,
          effects,
          effectsOther: effects.includes(OTHER) ? other : "",
          note,
          measurementName,
          measurementValue,
          measurementUnit,
        });
        if (result.saved) {
          toast.success({ message: result.toast ?? CHECK_IN_SAVED });
          onClose();
          return;
        }
        if (result.error) setError(result.error);
        else if (result.toast) toast.error({ message: result.toast });
      } catch (caught) {
        unstable_rethrow(caught);
        toast.error({ message: SAVE_FAILED_MESSAGE });
      }
    });
  };

  return (
    <SheetContent
      title={start ? "Today's check-in" : "Daily check-in"}
      context={context.dayLabel}
      footer={
        <Button size="lg" block onClick={save} saving={pending}>
          {start ? "Update check-in" : "Save check-in"}
        </Button>
      }
    >
      <section aria-labelledby="checkin-feeling" className="flex flex-col gap-2.5 px-2">
        <div className="flex items-baseline justify-between">
          <h3 id="checkin-feeling" className="text-[13px] font-semibold text-ink-2">
            Overall feeling
          </h3>
          {feeling ? (
            <span className="font-mono text-[13px] font-semibold" data-testid="checkin-feeling">
              {feeling} · {FEELING_WORDS[feeling]}
            </span>
          ) : null}
        </div>
        <div role="radiogroup" aria-labelledby="checkin-feeling" className="grid grid-cols-5 gap-1.5">
          {FEELINGS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={feeling === value}
              aria-label={`${value} · ${FEELING_WORDS[value]}`}
              onClick={() => setFeeling(value)}
              className={cn(
                "flex h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[14px]",
                feeling === value ? "bg-ink text-surface" : "bg-sunken text-ink",
              )}
            >
              <b className="text-[18px] font-semibold">{value}</b>
              <span className={cn("text-[12px]", feeling === value ? "text-on-ink-2" : "text-ink-2")}>{FEELING_WORDS[value]}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="checkin-effects" className="flex flex-col gap-2.5 px-2">
        <div className="flex items-baseline justify-between">
          <h3 id="checkin-effects" className="text-[13px] font-semibold text-ink-2">
            Anything unwanted?
          </h3>
          <span className="text-[13px] text-ink-3">Pick any</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <ChipGroup
            multiple
            aria-labelledby="checkin-effects"
            className="contents"
            value={effects.filter((e) => e !== OTHER)}
            onValueChange={(next) => {
              // One chip changed: apply R6's rule ("None" is picked alone).
              const toggled = EFFECTS.find((e) => e !== OTHER && next.includes(e) !== effects.includes(e));
              if (toggled) setEffects(toggleEffect(effects, toggled));
            }}
            options={EFFECTS.filter((e) => e !== OTHER).map((value) => ({ value, label: value }))}
          />
          <OtherChip
            picked={effects.includes(OTHER)}
            onClick={() => {
              const picking = !effects.includes(OTHER);
              setEffects(toggleEffect(effects, OTHER));
              if (picking) setTimeout(() => otherRef.current?.focus(), 0);
            }}
          />
        </div>
        {effects.includes(OTHER) ? (
          <Field label="Other effect" description="A few words, up to 100 characters">
            <TextInput ref={otherRef} compact value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. dizziness" />
          </Field>
        ) : null}
      </section>

      <section aria-labelledby="checkin-measurement" className="flex flex-col gap-2 px-2">
        <h3 id="checkin-measurement" className="text-[13px] font-semibold text-ink-2">
          Measurement <span className="font-medium text-ink-3">· optional</span>
        </h3>
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-2">
          <label className="relative flex">
            <span className="sr-only">Measurement type</span>
            <select
              value={measurementName}
              onChange={(e) => {
                const name = e.target.value as MeasurementName;
                setError(null);
                setNameValue(name);
                setUnitValue(unitFor(name));
              }}
              className="h-14 w-full cursor-pointer appearance-none rounded-[12px] border border-line bg-surface pr-9 pl-3.5 text-[16px] font-semibold text-ink"
            >
              {MEASUREMENTS.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
          </label>
          <Field label={<span className="sr-only">Value</span>} className="gap-0">
            <NumberInput
              value={measurementValue}
              placeholder="—"
              onChange={(e) => setValue(e.target.value)}
              unit={measurementName === "Other" ? undefined : measurementUnit}
            />
          </Field>
        </div>
        {measurementName === "Other" ? (
          <Field label="Unit">
            <TextInput compact value={measurementUnit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        ) : null}
        {last ? (
          <p className="font-mono text-[12px] text-ink-3" data-testid="checkin-last">
            Last: {last.value} {last.unit} · {last.day.replace(",", "")}
          </p>
        ) : null}
      </section>

      <Field label="Note" optional className="px-2">
        <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else worth noting" />
      </Field>

      {error ? (
        <p role="alert" className="mx-2 flex items-start gap-1.5 text-[14px] font-medium text-missed">
          <Info className="mt-0.5 size-[15px] shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </SheetContent>
  );
}

/** R6's "+ Other": a dashed add chip; once picked, a selected chip with a check (its text field shows below). */
function OtherChip({ picked, onClick }: { picked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-chip border px-3.5 text-[15px] select-none",
        picked ? "border-ink bg-ink font-semibold text-surface" : "border-dashed border-ink-3 bg-transparent text-ink-2",
      )}
    >
      {picked ? <Check className="size-[15px]" strokeWidth={2.5} aria-hidden /> : <Plus className="size-4" aria-hidden />}
      {OTHER}
    </button>
  );
}
