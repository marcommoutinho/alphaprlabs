"use client";

import { useState } from "react";
import { finishVialAction, saveVialAction, type SuppliesActionResult } from "@/app/(private)/app/supplies/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { Modal, ModalClose } from "@/components/app-shell/modal";
import { useSubmit } from "@/components/app-shell/use-submit";
import type { MixtureOption, SuppliesView, VialCard } from "@/lib/supplies/view";

const NOT_MIXED = "";

/** "Compound A · 8 mg / 2 mL · 1 mL — vial A-01 open" (a mixture takes one open vial). */
const optionLabel = (mixture: MixtureOption) => `${mixture.label}${mixture.openVial ? ` — vial ${mixture.openVial} open` : ""}`;

/**
 * R8 "Add a vial": an optional label ("Vial N" when blank), the saved
 * mixture it was mixed to (its peptide and vial strength come with it), or
 * "Not mixed yet" with the peptide and strength typed in.
 */
export function AddVialForm({ view }: { view: SuppliesView }) {
  const save = useSubmit(saveVialAction);
  const firstFree = view.mixtures.find((mixture) => !mixture.openVial)?.id ?? NOT_MIXED;
  const [label, setLabel] = useState("");
  const [mixtureId, setMixtureId] = useState(firstFree);
  const [peptideId, setPeptideId] = useState("");
  const [strength, setStrength] = useState("");
  const mixture = view.mixtures.find((m) => m.id === mixtureId) ?? null;

  const submit = () =>
    save.submit({
      id: null,
      label,
      mixtureId: mixture?.id ?? null,
      peptideId: mixture ? mixture.peptideId : peptideId,
      strengthMg: mixture ? mixture.strengthMg : strength,
    });

  return (
    <form
      className="app-sup-add"
      aria-labelledby="add-vial"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <b id="add-vial" className="app-sup-add-title">
        Add a vial
      </b>
      <div className="app-sup-add-grid">
        <Field label="Your label · optional">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. A-02" maxLength={40} />
        </Field>
        <Field label="Saved mixture">
          <select value={mixtureId} onChange={(event) => setMixtureId(event.target.value)}>
            <option value={NOT_MIXED}>Not mixed yet</option>
            {view.mixtures.map((m) => (
              <option key={m.id} value={m.id} disabled={m.openVial !== null}>
                {optionLabel(m)}
              </option>
            ))}
          </select>
        </Field>
        {mixture ? (
          <div className="app-sup-add-strength">
            <span className="app-field-label">Strength (mg)</span>
            <span className="app-sup-add-fixed" data-testid="add-strength">
              {mixture.strengthMg} mg · from the mixture
            </span>
          </div>
        ) : (
          <>
            <Field label="Peptide">
              <select value={peptideId} onChange={(event) => setPeptideId(event.target.value)}>
                <option value="">Choose…</option>
                {view.peptides.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Strength (mg)">
              <input value={strength} onChange={(event) => setStrength(event.target.value)} inputMode="decimal" placeholder="e.g. 8" />
            </Field>
          </>
        )}
      </div>
      {view.mixtures.length === 0 ? <p className="app-sup-hint">Save a mixture in the calculator to link a vial to it.</p> : null}
      <InlineError>{save.error}</InlineError>
      <AppButton type="submit" size="sm" saving={save.pending} className="app-sup-add-btn">
        Add vial
      </AppButton>
    </form>
  );
}

/** A vial's edit: its label and the saved mixture it uses (same peptide and strength), or "Not mixed yet". */
export function EditVialModal({ vial, view, onClose }: { vial: VialCard | null; view: SuppliesView; onClose: () => void }) {
  return (
    <Modal open={vial !== null} onOpenChange={(open) => (open ? null : onClose())} label="Edit vial">
      {vial ? <EditVialForm key={vial.id} vial={vial} view={view} onClose={onClose} /> : null}
    </Modal>
  );
}

function EditVialForm({ vial, view, onClose }: { vial: VialCard; view: SuppliesView; onClose: () => void }) {
  const save = useSubmit(saveVialAction);
  const [label, setLabel] = useState(vial.label);
  const [mixtureId, setMixtureId] = useState(vial.mixtureId && view.mixtures.some((m) => m.id === vial.mixtureId) ? vial.mixtureId : NOT_MIXED);
  // Its own peptide and strength only; a mixture holding another open vial can't take this one.
  const options = view.mixtures.filter((m) => m.peptideId === vial.peptideId && m.strengthMg === vial.strengthMg);

  return (
    <form
      className="app-sup-modal"
      onSubmit={(event) => {
        event.preventDefault();
        save.submit(
          { id: vial.id, label, mixtureId: mixtureId || null, peptideId: vial.peptideId, strengthMg: vial.strengthMg },
          (result: SuppliesActionResult) => {
            if (result?.saved) onClose();
          },
        );
      }}
    >
      <h2 className="app-sup-modal-title">Edit vial {vial.label}</h2>
      <p className="app-sup-modal-sub">
        {vial.peptideName} · {vial.strengthMg} mg vial. The peptide and strength stay; a different vial is a new vial.
      </p>
      <Field label="Your label">
        <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} required />
      </Field>
      <Field label="Saved mixture">
        <select value={mixtureId} onChange={(event) => setMixtureId(event.target.value)}>
          <option value={NOT_MIXED}>Not mixed yet</option>
          {options.map((m) => (
            <option key={m.id} value={m.id} disabled={m.openVial !== null && m.id !== vial.mixtureId}>
              {optionLabel(m)}
            </option>
          ))}
        </select>
      </Field>
      <InlineError>{save.error}</InlineError>
      <div className="app-sup-modal-actions">
        <AppButton type="submit" saving={save.pending}>
          Save vial
        </AppButton>
        <ModalClose className="app-btn app-btn--secondary">Cancel</ModalClose>
      </div>
    </form>
  );
}

/** "Finish" asks first: the vial moves to finished with its history, and can be reopened. */
export function FinishVialModal({ vial, onClose }: { vial: VialCard | null; onClose: () => void }) {
  const finish = useSubmit(finishVialAction);
  return (
    <Modal open={vial !== null} onOpenChange={(open) => (open ? null : onClose())} label="Finish vial">
      {vial ? (
        <div className="app-sup-modal">
          <h2 className="app-sup-modal-title">Finish vial {vial.label}?</h2>
          <p className="app-sup-modal-sub">
            It moves to finished with its history. Confirmed doses stop deducting from it, and its mixture can take a new vial. You can reopen
            it.
          </p>
          <div className="app-sup-modal-actions">
            <AppButton
              saving={finish.pending}
              onClick={() => finish.submit({ id: vial.id, label: vial.label }, (result) => (result?.saved ? onClose() : undefined))}
            >
              Finish vial
            </AppButton>
            <ModalClose className="app-btn app-btn--secondary">Cancel</ModalClose>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
