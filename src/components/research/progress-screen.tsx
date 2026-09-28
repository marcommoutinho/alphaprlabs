"use client";

import Link from "@/components/alpha/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCheckInAction } from "@/app/(private)/app/progress/actions";
import { AppButton, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import {
  EFFECTS,
  type Effect,
  FEELINGS,
  MEASUREMENTS,
  NO_CYCLE,
  NO_CYCLE_OPTION,
  NO_CYCLE_SELECTED,
  NOT_EVIDENCE,
  ONE_ENTRY,
  OTHER,
  toggleEffect,
  unitFor,
} from "@/lib/progress/rules";
import { type HistoryDay, NO_CYCLE_PARAM, type ProgressView } from "@/lib/progress/view";

/**
 * R9 Progress (the prototype's progress screen): the cycle picker, its goal
 * and baseline, today's check-in (one entry across all active peptides; no
 * cycle needed) and "Last 14 days" with each day's check-in, beside the doses
 * recorded and the cycle's phases when a cycle is picked, for the
 * researcher's own comparison only.
 */
export function ProgressScreen({ view }: { view: ProgressView }) {
  const router = useRouter();
  const { cycle, form } = view;
  return (
    <>
      <div className="app-pg-head">
        <h1 className="app-h1">Progress</h1>
        {view.cycles.length ? (
          <select
            className="app-pg-cycle"
            aria-label="Cycle"
            value={cycle?.id ?? NO_CYCLE_PARAM}
            onChange={(event) => router.push(`/app/progress?cycle=${encodeURIComponent(event.target.value)}`)}
          >
            {view.cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NO_CYCLE_PARAM}>{NO_CYCLE_OPTION}</option>
          </select>
        ) : null}
      </div>
      {cycle ? (
        <div className="app-pg-goal" data-testid="progress-goal">
          <span className="app-pg-dates">
            {cycle.dates} · {cycle.status}
          </span>{" "}
          · Goal: <b>{cycle.goal}</b> · Baseline: <b>{cycle.baseline}</b>
          {cycle.hasBaseline ? null : (
            <>
              {" "}
              · <Link href={cycle.editHref}>Add a baseline</Link>
            </>
          )}
        </div>
      ) : (
        <div className="app-pg-goal" data-testid="progress-goal">
          {view.cycles.length ? (
            NO_CYCLE_SELECTED
          ) : (
            <>
              {NO_CYCLE} <Link href="/app/cycles/new">Create a cycle</Link> to see them beside your doses.
            </>
          )}
        </div>
      )}

      <div className="app-pg-grid">
        <CheckInForm key={`${form.day}:${form.start?.version ?? 0}`} form={form} />
        <section className="app-pg-history" aria-labelledby="pg-history">
          <div className="app-pg-history-head">
            <h2 id="pg-history">Last 14 days</h2>
            <span>{NOT_EVIDENCE}</span>
          </div>
          {view.sparse ? <p className="app-pg-sparse">{view.sparse}</p> : null}
          <div className="app-pg-rows">
            {view.rows.map((row) => (
              <DayRow key={row.day} row={row} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function CheckInForm({ form }: { form: ProgressView["form"] }) {
  const save = useSubmit(saveCheckInAction);
  const start = form.start;
  const [feeling, setFeeling] = useState(start?.feeling ?? 0);
  const [effects, setEffects] = useState<Effect[]>(start?.effects ?? []);
  const [other, setOther] = useState(start?.effectsOther ?? "");
  const [note, setNote] = useState(start?.note ?? "");
  const [name, setName] = useState(start?.measurement?.name ?? MEASUREMENTS[0].name);
  const [value, setValue] = useState(start?.measurement?.value ?? "");
  const [unit, setUnit] = useState(start?.measurement?.unit ?? MEASUREMENTS[0].unit);

  const pickName = (next: string) => {
    // The suggested unit follows the name, unless one was typed.
    if (unit === "" || unit === unitFor(name)) setUnit(unitFor(next));
    setName(next);
  };

  return (
    <form
      className="app-pg-form"
      aria-labelledby="pg-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.submit({
          day: form.day,
          version: start?.version ?? null,
          feeling,
          effects,
          effectsOther: effects.includes(OTHER) ? other : "",
          note,
          measurementName: name,
          measurementValue: value,
          measurementUnit: unit,
        });
      }}
    >
      <div className="app-pg-form-head">
        <h2 id="pg-form">{form.title}</h2>
        <span>{ONE_ENTRY}</span>
      </div>

      <div className="app-pg-block">
        <div className="app-field-label">Overall feeling</div>
        <div className="app-pg-feelings" role="radiogroup" aria-label="Overall feeling 1 to 5">
          {FEELINGS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={feeling === n} className="app-pg-feeling" onClick={() => setFeeling(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="app-pg-scale">
          <span>1 · poor</span>
          <span>5 · great</span>
        </div>
      </div>

      <div className="app-pg-block">
        <div className="app-field-label" id="pg-effects">
          Unwanted effects · pick any
        </div>
        <div className="app-pg-chips" role="group" aria-labelledby="pg-effects">
          {EFFECTS.map((effect) => (
            <button
              key={effect}
              type="button"
              className="app-pg-chip"
              aria-pressed={effects.includes(effect)}
              onClick={() => setEffects((current) => toggleEffect(current, effect))}
            >
              {effect}
            </button>
          ))}
        </div>
        {effects.includes(OTHER) ? (
          <label className="app-field">
            <span className="app-field-label">Other effect</span>
            <input value={other} onChange={(event) => setOther(event.target.value)} placeholder="A few words, up to 100 characters" />
          </label>
        ) : null}
      </div>

      <label className="app-pg-block app-field">
        <span className="app-field-label">Note · optional</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Anything worth remembering" />
      </label>

      <div className="app-pg-block app-pg-measure">
        <div className="app-field-label">Measurement for your goal · optional</div>
        <div className="app-pg-measure-grid">
          <select aria-label="What" value={name} onChange={(event) => pickName(event.target.value)}>
            {MEASUREMENTS.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <input aria-label="Value" inputMode="decimal" placeholder="Value" value={value} onChange={(event) => setValue(event.target.value)} />
          <input aria-label="Unit" placeholder="Unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
        </div>
      </div>

      <InlineError>{save.error}</InlineError>
      <AppButton type="submit" block saving={save.pending} className="app-pg-save">
        {form.saveLabel}
      </AppButton>
    </form>
  );
}

function DayRow({ row }: { row: HistoryDay }) {
  return (
    <div className="app-pg-row" data-testid="progress-day" data-day={row.day} data-today={row.today || undefined}>
      <div className="app-pg-day">
        {row.label}
        {row.phase ? <div className="app-pg-phase">{row.phase}</div> : null}
      </div>
      <div className="app-pg-entry">
        <div className="app-pg-feel">
          <div className="app-pg-bars" role="img" aria-label={row.feelLabel}>
            {FEELINGS.map((n) => (
              <i key={n} data-on={row.feeling !== null && n <= row.feeling ? "" : undefined} />
            ))}
          </div>
          <span data-testid="progress-feel">{row.feelLabel}</span>
        </div>
        {row.effects ? (
          <div className="app-pg-effects" data-testid="progress-effects">
            {row.effects}
          </div>
        ) : null}
        {row.note ? (
          <div className="app-pg-note" data-testid="progress-note">
            “{row.note}”
          </div>
        ) : null}
        {row.measure ? (
          <div className="app-pg-measured" data-testid="progress-measure">
            {row.measure}
          </div>
        ) : null}
        {row.doses !== null ? (
          <div className="app-pg-doses" data-testid="progress-doses">
            {row.doses}
          </div>
        ) : null}
      </div>
    </div>
  );
}
