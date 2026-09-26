"use client";

import { Field } from "@/components/app-shell/form";
import type { Weekday } from "@/lib/schedule/engine";
import { phaseTitle, WEEKDAY_TOGGLES } from "@/lib/templates/display";
import { newActivePhase, newBreak, nextPhaseDay, type PhaseForm, type PlanForm } from "@/lib/templates/rules";

/**
 * A3 "What researchers receive": one peptide's block with its phases, "+ Phase"
 * and "+ Break". Days are relative: "Starts on day" 1 is the researcher's
 * start date.
 */
export function TemplatePlanEditor({
  name,
  plan,
  onChange,
  onRemove,
}: {
  name: string;
  plan: PlanForm;
  onChange: (plan: PlanForm) => void;
  onRemove: () => void;
}) {
  const setPhases = (phases: PhaseForm[]) => onChange({ ...plan, phases });
  const updatePhase = (index: number, patch: Partial<PhaseForm>) =>
    setPhases(plan.phases.map((phase, j) => (j === index ? { ...phase, ...patch } : phase)));

  return (
    <div className="app-tpl-plan" data-testid="template-plan">
      <div className="app-tpl-plan-head">
        <b className="app-tpl-plan-name">{name}</b>
        <button type="button" className="app-tpl-link" onClick={onRemove}>
          Remove peptide
        </button>
      </div>
      {plan.phases.map((phase, index) => (
        <PhaseEditor
          // Phases have no identity until saved; every input is controlled.
          key={index}
          phase={phase}
          onChange={(patch) => updatePhase(index, patch)}
          onRemove={() => setPhases(plan.phases.filter((_, j) => j !== index))}
        />
      ))}
      <div className="app-tpl-buttons">
        <button
          type="button"
          className="app-tpl-small-btn"
          onClick={() => setPhases([...plan.phases, newActivePhase(nextPhaseDay(plan))])}
        >
          + Phase
        </button>
        <button type="button" className="app-tpl-small-btn" onClick={() => setPhases([...plan.phases, newBreak(nextPhaseDay(plan))])}>
          + Break
        </button>
      </div>
    </div>
  );
}

function PhaseEditor({
  phase,
  onChange,
  onRemove,
}: {
  phase: PhaseForm;
  onChange: (patch: Partial<PhaseForm>) => void;
  onRemove: () => void;
}) {
  const { word, range } = phaseTitle(phase);
  const active = phase.kind === "active";
  const toggleDay = (day: Weekday) =>
    onChange({ days: phase.days.includes(day) ? phase.days.filter((d) => d !== day) : [...phase.days, day] });

  return (
    <div className="app-tpl-phase" data-kind={phase.kind} data-testid="template-phase">
      <div className="app-tpl-phase-head">
        <span className="app-tpl-phase-title">
          {word} {range ? <span className="app-tpl-phase-range">{range}</span> : null}
        </span>
        <button type="button" className="app-tpl-link" onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="app-tpl-grid">
        <Field label="Starts on day">
          <input inputMode="numeric" autoComplete="off" value={phase.day} onChange={(e) => onChange({ day: e.target.value })} />
        </Field>
        <Field label="Length (days)">
          <input inputMode="numeric" autoComplete="off" value={phase.len} onChange={(e) => onChange({ len: e.target.value })} />
        </Field>
        {active ? (
          <>
            <Field label="Dose (mg)">
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 0.4"
                value={phase.mg}
                onChange={(e) => onChange({ mg: e.target.value })}
              />
            </Field>
            <Field label="Local time">
              <input type="time" value={phase.time} onChange={(e) => onChange({ time: e.target.value })} />
            </Field>
            <Field label="Schedule" className="app-tpl-wide">
              <select
                value={phase.schedule}
                onChange={(e) => onChange({ schedule: e.target.value === "weekdays" ? "weekdays" : "interval" })}
              >
                <option value="interval">Every N days</option>
                <option value="weekdays">Fixed weekdays</option>
              </select>
            </Field>
            {phase.schedule === "interval" ? (
              <Field label="Every (days)">
                <input inputMode="numeric" autoComplete="off" value={phase.every} onChange={(e) => onChange({ every: e.target.value })} />
              </Field>
            ) : (
              <div className="app-tpl-wide" role="group" aria-label="Weekdays">
                <span className="app-field-label" aria-hidden="true">
                  Weekdays
                </span>
                <div className="app-tpl-days">
                  {WEEKDAY_TOGGLES.map(({ day, label }) => (
                    <button
                      key={day}
                      type="button"
                      className="app-tpl-day"
                      aria-pressed={phase.days.includes(day)}
                      onClick={() => toggleDay(day)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
