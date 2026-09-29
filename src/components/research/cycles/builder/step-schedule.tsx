"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/alpha/button";
import { Field, NumberInput, TextInput } from "@/components/alpha/field";
import { Segmented } from "@/components/alpha/segmented";
import { clock12, massLabel, mgFromUnit, shortDate } from "@/lib/alpha/format";
import { isPositiveDecimal } from "@/lib/calculator/decimal";
import { type BuilderPhase, type BuilderPlan, endsBefore, type Frequency, mixReading, phaseNames, previewPhases } from "@/lib/cycles/builder";
import { type AxisLabel, dateRange, daysLabel, laneBars, monthDay, plusDays } from "@/lib/cycles/geometry";
import type { Weekday } from "@/lib/schedule/engine";
import { isLocalDate } from "@/lib/schedule/zone";
import { cn } from "@/lib/utils";
import { AxisRow, CardLane } from "../lanes";

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "every", label: "Every N days" },
] as const;

/** Mon … Sun. */
const WEEK: { day: Weekday; label: string }[] = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

const whole = (text: string): number | null => (/^\s*\d{1,5}\s*$/.test(text) ? Number(text.trim()) : null);

/** "daily", "Mon, Wed, Fri", "every 3 days". */
function frequencyWords(phase: BuilderPhase): string {
  if (phase.frequency === "daily") return "daily";
  if (phase.frequency === "every") return `every ${phase.every || "N"} days`;
  const days = WEEK.filter((w) => phase.days.includes(w.day)).map((w) => w.label);
  return days.length ? days.join(", ") : "no weekdays";
}

/** "Days 1–56 · Sep 1 – Oct 26" once the start day and length are whole numbers. */
function span(phase: BuilderPhase, start: string, dates = true): string {
  const [day, length] = [whole(phase.day), whole(phase.length)];
  if (day === null || length === null || day < 1 || length < 1) return "Set its days";
  const text = daysLabel(day, day + length - 1);
  if (!dates || !isLocalDate(start)) return text;
  return `${text} · ${dateRange(plusDays(start, day - 1), plusDays(start, day + length - 2))}`;
}

/**
 * R4c Schedule and dates (one peptide): the cycle's start and length, the
 * peptide's lane (redrawn as you edit), then its phases and breaks as
 * blocks, one open for editing (2 px `ink` border), the others collapsed.
 * One dose time per phase (Marco): no second daily time.
 */
export function StepSchedule({
  plan,
  name,
  start,
  startLocked,
  totalDays,
  effective,
  expanded,
  onExpand,
  onStart,
  onPhase,
  onRemove,
}: {
  plan: BuilderPlan;
  name: string;
  start: string;
  startLocked: boolean;
  /** The cycle's length so far (every peptide). */
  totalDays: number;
  /** While editing: the first date changes apply from (a started phase ends the day before at the earliest). */
  effective: string | null;
  expanded: string | null;
  onExpand: (key: string | null) => void;
  onStart: (start: string) => void;
  onPhase: (key: string, patch: Partial<BuilderPhase>) => void;
  onRemove: (key: string) => void;
}) {
  const names = phaseNames(plan.phases);
  const total = Math.max(1, totalDays);
  const bars = laneBars(previewPhases(plan, start), start, total);
  const end = isLocalDate(start) && totalDays > 0 ? plusDays(start, totalDays - 1) : null;
  const labels: AxisLabel[] = [];
  if (totalDays > 0) {
    labels.push({ text: "Day 1", percent: 0, align: "start" });
    for (const bar of bars) {
      const percent = ((bar.from - 1) / total) * 100;
      if (bar.from > 1 && labels.every((label) => Math.abs(label.percent - percent) >= 9) && percent <= 88) labels.push({ text: String(bar.from), percent, align: "center" });
    }
    if (total > 1) labels.push({ text: String(total), percent: 100, align: "end" });
  }

  return (
    <>
      <div className="mx-3 mt-3.5 grid grid-cols-2 rounded-group border border-line bg-surface laptop:mx-0">
        <label className="px-4 py-3">
          <span className="block text-[12px] text-ink-3">Starts</span>
          <input
            type="date"
            value={start}
            readOnly={startLocked}
            onChange={(e) => onStart(e.target.value)}
            aria-label="Cycle starts"
            className="mt-1 w-full bg-transparent font-mono text-base font-semibold text-ink outline-none read-only:text-ink-2"
          />
          {isLocalDate(start) ? <span className="block text-[12px] text-ink-3">{shortDate(start)}</span> : null}
        </label>
        <div className="border-l border-line px-4 py-3">
          <div className="text-[12px] text-ink-3">Length</div>
          <div className="mt-1 font-mono text-base font-semibold" data-testid="cycle-length">
            {totalDays} {totalDays === 1 ? "day" : "days"}
          </div>
          {end ? <div className="text-[12px] text-ink-3">Ends {monthDay(end)}</div> : null}
        </div>
      </div>

      <div className="mx-5 mt-4 laptop:mx-0" data-testid="lane-preview">
        <CardLane bars={bars} todayPercent={null} height={10} />
        <AxisRow labels={labels} className="mt-1.5" />
      </div>

      <ol className="mx-3 mt-3 flex flex-col gap-2 laptop:mx-0" aria-label={`${name} phases`}>
        {plan.phases.map((phase, i) => (
          <li key={phase.key} data-testid="builder-phase" data-kind={phase.kind}>
            {expanded === phase.key && phase.lock !== "ended" ? (
              <PhaseCard
                phase={phase}
                title={names[i]}
                plan={plan}
                start={start}
                effective={effective}
                onChange={(patch) => onPhase(phase.key, patch)}
                onRemove={() => onRemove(phase.key)}
                onClose={() => onExpand(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => (phase.lock === "ended" ? undefined : onExpand(phase.key))}
                aria-expanded={false}
                aria-disabled={phase.lock === "ended" || undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[16px] px-4 py-3 text-left",
                  phase.kind === "break" ? "border border-dashed border-ink-3" : "border border-line bg-surface",
                  phase.lock === "ended" && "cursor-default opacity-70",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-base font-semibold">
                      {names[i]}
                      {phase.lock === "ended" ? <span className="text-[12px] font-normal text-ink-3">Done</span> : null}
                      {phase.lock === "started" && effective && endsBefore(phase, start, effective) ? (
                        <span className="text-[12px] font-normal text-ink-3" data-slot="ending">
                          Ends {shortDate(plusDays(effective, -1))}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[13px] font-medium text-ink-2">
                      {phase.kind === "break" ? `${span(phase, start, false)} · ${phase.length || "?"} days` : span(phase, start, false)}
                    </span>
                  </span>
                  {phase.kind === "active" ? (
                    <span className="mt-0.5 block text-[13px] text-ink-2">
                      {isPositiveDecimal(mgFromUnit(phase.dose, plan.unit)) ? massLabel(mgFromUnit(phase.dose, plan.unit)) : "No dose yet"} · {frequencyWords(phase)} · {clock12(phase.time)}
                    </span>
                  ) : null}
                </span>
                {phase.lock === "ended" ? null : <ChevronDown className="size-[18px] shrink-0 text-ink-3" aria-hidden />}
              </button>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function PhaseCard({
  phase,
  title,
  plan,
  start,
  effective,
  onChange,
  onRemove,
  onClose,
}: {
  phase: BuilderPhase;
  title: string;
  plan: BuilderPlan;
  start: string;
  effective: string | null;
  onChange: (patch: Partial<BuilderPhase>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const mg = mgFromUnit(phase.dose, plan.unit);
  const reading = phase.kind === "active" ? mixReading(plan.mix, mg) : null;
  const started = phase.lock === "started";
  // Ended with "End it now": its last day is the one before the edit applies.
  const ending = started && effective !== null && endsBefore(phase, start, effective);
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col gap-3 rounded-group px-4 py-3.5", phase.kind === "break" ? "border-2 border-dashed border-ink" : "border-2 border-ink bg-surface")}
      data-testid="phase-editor"
    >
      <div className="flex items-baseline justify-between gap-2">
        <button type="button" onClick={onClose} className="text-base font-semibold" aria-expanded>
          {title}
        </button>
        <span className="font-mono text-[13px] font-medium text-ink-2" data-slot="span">
          {span(phase, start)}
        </span>
      </div>
      {ending ? (
        <p className="text-[13px] text-ink-2" data-testid="phase-ending">
          Ends {shortDate(plusDays(effective!, -1))}: nothing is planned after that, and its doses so far stay in the history.
        </p>
      ) : started ? (
        <p className="text-[13px] text-ink-2">
          Under way, so its start stays.{effective ? ` Changes apply from ${shortDate(effective)}.` : ""}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Starts on day">
          <TextInput compact mono inputMode="numeric" value={phase.day} readOnly={started} onChange={(e) => onChange({ day: (e.target as HTMLInputElement).value })} />
        </Field>
        <Field label="Length (days)">
          <TextInput compact mono inputMode="numeric" value={phase.length} onChange={(e) => onChange({ length: (e.target as HTMLInputElement).value })} />
        </Field>
      </div>
      {phase.kind === "active" ? (
        <>
          <Field label="Dose" description={reading ? `${reading.display.units} units on the ${plan.mix.syringe}-unit syringe` : undefined}>
            <NumberInput value={phase.dose} onChange={(e) => onChange({ dose: (e.target as HTMLInputElement).value })} unit={plan.unit} className="h-12" />
          </Field>
          <Segmented<Frequency>
            aria-label="Frequency"
            value={phase.frequency}
            onValueChange={(frequency) => onChange({ frequency })}
            options={FREQUENCIES}
          />
          {phase.frequency === "weekdays" ? (
            <div role="group" aria-label="Weekdays" className="grid grid-cols-7 gap-1">
              {WEEK.map((w) => {
                const on = phase.days.includes(w.day);
                return (
                  <button
                    key={w.day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ days: on ? phase.days.filter((d) => d !== w.day) : [...phase.days, w.day].sort((a, b) => a - b) })}
                    className={cn("h-11 rounded-[10px] text-[14px]", on ? "bg-ink font-semibold text-surface" : "border border-line bg-surface")}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {phase.frequency === "every" ? (
            <Field label="Every">
              <NumberInput inputMode="numeric" value={phase.every} onChange={(e) => onChange({ every: (e.target as HTMLInputElement).value })} unit="days" className="h-12" />
            </Field>
          ) : null}
          <label className="flex items-center justify-between gap-3">
            <span className="text-[15px] text-ink-2">Time</span>
            <input
              type="time"
              value={phase.time}
              onChange={(e) => onChange({ time: e.target.value })}
              aria-label="Time"
              className="h-11 rounded-[12px] border border-line bg-paper px-3.5 font-mono text-base font-semibold text-ink laptop:text-[15px]"
            />
          </label>
        </>
      ) : null}
      <div className="flex justify-between gap-2">
        {ending ? (
          <span />
        ) : (
          <Button type="button" variant="destructive-text" size="sm" onClick={onRemove}>
            {started ? "End it now" : phase.kind === "break" ? "Remove break" : "Remove phase"}
          </Button>
        )}
        <Button type="button" variant="soft" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </section>
  );
}
