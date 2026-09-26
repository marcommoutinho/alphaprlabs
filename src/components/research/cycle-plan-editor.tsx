"use client";

import { Field } from "@/components/app-shell/form";
import type { PhaseLock } from "@/lib/cycles/revise";
import { type CyclePhaseForm, type CyclePlanForm, newActivePhase, newBreak, nextPhaseStart } from "@/lib/cycles/rules";
import { formatDay } from "@/lib/format";
import type { Weekday } from "@/lib/schedule/engine";
import { WEEKDAY_TOGGLES } from "@/lib/templates/display";

/**
 * R3: one peptide's section with its dated phases, "+ Phase" and "+ Break".
 * While editing, a phase that has ended is read-only and one under way keeps
 * its start date (changes apply from `from`); a peptide that has started
 * can't be removed, only ended through its phases.
 */
export function CyclePlanEditor({
  name,
  plan,
  locks,
  from,
  defaultStart,
  onChange,
  onRemove,
}: {
  name: string;
  plan: CyclePlanForm;
  locks: Readonly<Record<string, PhaseLock>>;
  /** The plan's earliest effective date while editing (null for a new cycle). */
  from: string | null;
  defaultStart: string;
  onChange: (plan: CyclePlanForm) => void;
  onRemove: () => void;
}) {
  const setPhases = (phases: CyclePhaseForm[]) => onChange({ ...plan, phases });
  const lockOf = (phase: CyclePhaseForm) => (phase.id ? (locks[phase.id] ?? null) : null);
  const started = plan.phases.some((phase) => lockOf(phase) !== null);
  const start = nextPhaseStart(plan, defaultStart);
  // New phases start on the effective date at the earliest.
  const addAt = from && start < from ? from : start;
  // The prototype's titles: active phases numbered in order, breaks "Break".
  const words = plan.phases.map((phase, index) =>
    phase.kind === "active" ? `Phase ${plan.phases.slice(0, index + 1).filter((p) => p.kind === "active").length}` : "Break",
  );

  return (
    <section className="app-cyc-plan" data-testid="cycle-plan" aria-label={name}>
      <div className="app-cyc-plan-head">
        <h2 className="app-cyc-plan-name">{name}</h2>
        {started ? null : (
          <button type="button" className="app-cyc-link" onClick={onRemove}>
            Remove peptide
          </button>
        )}
      </div>
      <div className="app-cyc-phases">
        {plan.phases.map((phase, index) => (
          <PhaseEditor
            // New phases have no identity until saved; every input is controlled.
            key={phase.id ?? `new-${index}`}
            phase={phase}
            word={words[index]}
            lock={lockOf(phase)}
            from={from}
            onChange={(patch) => setPhases(plan.phases.map((p, j) => (j === index ? { ...p, ...patch } : p)))}
            onRemove={() => setPhases(plan.phases.filter((_, j) => j !== index))}
          />
        ))}
      </div>
      <div className="app-cyc-buttons">
        <button type="button" className="app-cyc-small-btn" onClick={() => setPhases([...plan.phases, newActivePhase(addAt)])}>
          + Phase (change amount or frequency)
        </button>
        <button type="button" className="app-cyc-small-btn" onClick={() => setPhases([...plan.phases, newBreak(addAt)])}>
          + Break
        </button>
      </div>
    </section>
  );
}

function PhaseEditor({
  phase,
  word,
  lock,
  from,
  onChange,
  onRemove,
}: {
  phase: CyclePhaseForm;
  word: string;
  lock: PhaseLock;
  from: string | null;
  onChange: (patch: Partial<CyclePhaseForm>) => void;
  onRemove: () => void;
}) {
  const active = phase.kind === "active";
  const ended = lock === "ended";
  const toggleDay = (day: Weekday) =>
    onChange({ days: phase.days.includes(day) ? phase.days.filter((d) => d !== day) : [...phase.days, day] });

  return (
    <div className="app-cyc-phase" data-kind={phase.kind} data-lock={lock ?? undefined} data-testid="cycle-phase">
      <div className="app-cyc-phase-head">
        <span className="app-cyc-phase-title">{word}</span>
        {ended ? null : (
          <button type="button" className="app-cyc-link" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {/* Not in the prototype, which let an edit rewrite the past. */}
      {ended ? <p className="app-cyc-phase-note">Ended — kept exactly as recorded.</p> : null}
      {lock === "started" && from ? <p className="app-cyc-phase-note">Under way — changes apply from {formatDay(from)}.</p> : null}
      <fieldset className="app-cyc-grid" disabled={ended}>
        <Field label="Start">
          <input type="date" value={phase.start} disabled={lock !== null} onChange={(e) => onChange({ start: e.target.value })} />
        </Field>
        <Field label="End">
          <input type="date" value={phase.end} onChange={(e) => onChange({ end: e.target.value })} />
        </Field>
        {active ? (
          <>
            <Field label="Dose per administration (mg)">
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 0.4"
                value={phase.mg}
                onChange={(e) => onChange({ mg: e.target.value })}
              />
            </Field>
            <Field label="Schedule">
              <select
                value={phase.schedule}
                onChange={(e) => onChange({ schedule: e.target.value === "weekdays" ? "weekdays" : "interval" })}
              >
                <option value="interval">Every N days (follows the actual time of the last dose)</option>
                <option value="weekdays">Fixed weekdays (keeps weekday and clock time)</option>
              </select>
            </Field>
            {phase.schedule === "interval" ? (
              <Field label="Every (days)">
                <input inputMode="numeric" autoComplete="off" value={phase.every} onChange={(e) => onChange({ every: e.target.value })} />
              </Field>
            ) : (
              <div role="group" aria-label="Weekdays">
                <span className="app-field-label" aria-hidden="true">
                  Weekdays
                </span>
                <div className="app-cyc-days">
                  {WEEKDAY_TOGGLES.map(({ day, label }) => (
                    <button
                      key={day}
                      type="button"
                      className="app-cyc-day"
                      aria-pressed={phase.days.includes(day)}
                      onClick={() => toggleDay(day)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Field label="Local time">
              <input type="time" value={phase.time} onChange={(e) => onChange({ time: e.target.value })} />
            </Field>
          </>
        ) : null}
      </fieldset>
    </div>
  );
}
