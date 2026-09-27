"use client";

import { useState } from "react";
import { endRoutineAction, saveRoutineAction, type SupplementActionResult } from "@/app/(private)/app/supplements/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { Modal, ModalClose } from "@/components/app-shell/modal";
import { useSubmit } from "@/components/app-shell/use-submit";
import { validateRoutine } from "@/lib/supplements/rules";
import type { RoutineCard } from "@/lib/supplements/view";

type Values = { name: string; amount: string; unit: string; time: string };

/** The prototype's fields: Supplement, Amount and Unit, Daily at. */
function RoutineFields({ values, onChange }: { values: Values; onChange: (values: Values) => void }) {
  const set = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...values, [key]: event.target.value });
  return (
    <div className="app-supp-grid">
      <Field label="Supplement">
        <input value={values.name} onChange={set("name")} placeholder="e.g. Vitamin D3" autoComplete="off" />
      </Field>
      <div className="app-supp-pair">
        <Field label="Amount">
          <input value={values.amount} onChange={set("amount")} inputMode="decimal" placeholder="e.g. 2000" />
        </Field>
        <Field label="Unit">
          <input value={values.unit} onChange={set("unit")} placeholder="IU, mg, capsules" autoComplete="off" />
        </Field>
      </div>
      <Field label="Daily at">
        <input type="time" value={values.time} onChange={set("time")} />
      </Field>
    </div>
  );
}

/** An empty form (the prototype pre-filled an example; placeholders show one instead). */
const BLANK: Values = { name: "", amount: "", unit: "", time: "08:00" };

/** R10 "New routine": nothing is tracked until one is created; it starts today. */
export function NewRoutineForm() {
  const save = useSubmit(saveRoutineAction);
  const [values, setValues] = useState<Values>(BLANK);
  const submit = () => {
    const input = { id: null, version: null, ...values };
    // The prototype's checks first, on the page; the server checks again.
    const valid = validateRoutine(input);
    if (!valid.ok) return save.setError(valid.error);
    save.submit(input, (result: SupplementActionResult) => {
      if (result?.saved) setValues(BLANK);
    });
  };
  return (
    <form
      className="app-supp-add"
      aria-labelledby="new-routine"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <b id="new-routine" className="app-supp-add-title">
        New routine
      </b>
      <RoutineFields values={values} onChange={setValues} />
      <InlineError>{save.error}</InlineError>
      <AppButton type="submit" size="sm" saving={save.pending} className="app-supp-add-btn">
        Create routine
      </AppButton>
    </form>
  );
}

/** A routine's edit, from the version shown. Earlier Taken records keep what was taken. */
export function EditRoutineModal({ routine, onClose }: { routine: RoutineCard | null; onClose: () => void }) {
  return (
    <Modal open={routine !== null} onOpenChange={(open) => (open ? null : onClose())} label="Edit routine">
      {routine ? <EditRoutineForm key={`${routine.id}/${routine.version}`} routine={routine} onClose={onClose} /> : null}
    </Modal>
  );
}

function EditRoutineForm({ routine, onClose }: { routine: RoutineCard; onClose: () => void }) {
  const save = useSubmit(saveRoutineAction);
  const [values, setValues] = useState<Values>({ name: routine.name, amount: routine.amount, unit: routine.unit, time: routine.time });
  const submit = () => {
    const input = { id: routine.id, version: routine.version, ...values };
    const valid = validateRoutine(input);
    if (!valid.ok) return save.setError(valid.error);
    save.submit(input, (result: SupplementActionResult) => (result?.saved ? onClose() : undefined));
  };
  return (
    <form
      className="app-supp-modal"
      aria-label={`Edit ${routine.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="app-supp-modal-title">Edit {routine.name}</h2>
      <p className="app-supp-modal-sub">Changes apply from now on. What you already recorded as taken keeps its amount and time.</p>
      <RoutineFields values={values} onChange={setValues} />
      <InlineError>{save.error}</InlineError>
      <div className="app-supp-modal-actions">
        <AppButton type="submit" saving={save.pending}>
          Save routine
        </AppButton>
        <ModalClose className="app-btn app-btn--secondary">Cancel</ModalClose>
      </div>
    </form>
  );
}

/** "End routine" asks first: it runs through today and stops; its history is kept. */
export function EndRoutineModal({ routine, onClose }: { routine: RoutineCard | null; onClose: () => void }) {
  const end = useSubmit(endRoutineAction);
  return (
    <Modal open={routine !== null} onOpenChange={(open) => (open ? null : onClose())} label="End routine">
      {routine ? (
        <div className="app-supp-modal">
          <h2 className="app-supp-modal-title">End {routine.name}?</h2>
          <p className="app-supp-modal-sub">
            It stops after today and leaves Today and future reminders. Its history is kept. To start again, create a new routine.
          </p>
          <InlineError>{end.error}</InlineError>
          <div className="app-supp-modal-actions">
            <AppButton
              saving={end.pending}
              onClick={() => end.submit({ id: routine.id, version: routine.version }, (result) => (result?.saved ? onClose() : undefined))}
            >
              End routine
            </AppButton>
            <ModalClose className="app-btn app-btn--secondary">Cancel</ModalClose>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
