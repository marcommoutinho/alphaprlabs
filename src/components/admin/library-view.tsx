"use client";

import { useEffect, useRef, useState } from "react";
import { saveLibraryEntryAction } from "@/app/(private)/admin/library/actions";
import { AppButton, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import {
  availabilityBadge,
  editorTitle,
  LIBRARY_LIMITS,
  libraryMeta,
  referenceNote,
  type LibraryEntry,
  type LibraryEntryInput,
} from "@/lib/library/entry";
import "@/styles/app/library.css";

type EditorForm = LibraryEntryInput & { id: string | null };

const NEW_ENTRY: EditorForm = { id: null, name: "", information: "", cyclingOff: "", supplement: "", available: true };

const formOf = (entry: LibraryEntry): EditorForm => ({
  id: entry.id,
  name: entry.name,
  information: entry.information,
  cyclingOff: entry.cyclingOff,
  supplement: entry.supplement,
  available: entry.available,
});

/** A2: the entry list (left) and the editor (right); stacked on phone. */
export function LibraryView({ entries }: { entries: LibraryEntry[] }) {
  const [form, setForm] = useState<EditorForm | null>(null);
  const { pending, error, setError, submit } = useSubmit(saveLibraryEntryAction);
  // Set when the current error belongs under the name (a duplicate name).
  const [errorField, setErrorField] = useState<"name" | undefined>();
  const nameError = errorField === "name" ? error : undefined;
  const editorRef = useRef<HTMLElement>(null);
  const editing = form !== null;

  // On phone the editor sits below the list: bring it into view when opened.
  useEffect(() => {
    if (editing && window.matchMedia("(max-width: 759.98px)").matches) {
      editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [editing, form?.id]);

  function open(next: EditorForm) {
    setError(undefined);
    setErrorField(undefined);
    setForm(next);
  }

  function update<K extends keyof EditorForm>(key: K, value: EditorForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  const note = referenceNote(form?.id ? (entries.find((entry) => entry.id === form.id) ?? null) : null);

  return (
    <>
      <div className="app-lib-head">
        <div>
          <h1 className="app-h1">Peptide library</h1>
          <p className="app-subtitle">
            Supplied information and internal guidance researchers see. Maintenance only — nothing here generates
            research.
          </p>
        </div>
        <AppButton size="sm" onClick={() => open(NEW_ENTRY)}>
          Add peptide
        </AppButton>
      </div>

      <div className="app-lib">
        <div className="app-lib-list">
          {entries.map((entry) => {
            const selected = form?.id === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                className="app-lib-row"
                data-testid="library-row"
                data-selected={selected || undefined}
                aria-current={selected || undefined}
                onClick={() => open(formOf(entry))}
              >
                <span className="app-lib-row-text">
                  <b className="app-lib-row-name">{entry.name}</b>
                  <span className="app-lib-row-meta">{libraryMeta(entry)}</span>
                </span>
                <span className="app-lib-badge" data-available={entry.available}>
                  {availabilityBadge(entry.available)}
                </span>
              </button>
            );
          })}
        </div>

        {form ? (
          <section ref={editorRef} className="app-card app-lib-editor" aria-labelledby="library-editor-title">
            <h2 id="library-editor-title" className="app-card-title">
              {editorTitle(form.id === null, form.name)}
            </h2>
            <form
              noValidate
              className="app-lib-fields"
              onSubmit={(event) => {
                event.preventDefault();
                submit(form, (result) => {
                  setErrorField(result.field);
                  if (result.saved) setForm(null);
                });
              }}
            >
              <Field label="Name">
                <input
                  name="name"
                  autoComplete="off"
                  maxLength={LIBRARY_LIMITS.name}
                  value={form.name}
                  aria-invalid={nameError ? true : undefined}
                  onChange={(e) => update("name", e.target.value)}
                />
              </Field>
              {nameError ? (
                <div className="app-lib-field-error">
                  <InlineError>{nameError}</InlineError>
                </div>
              ) : null}
              <Field label="Information researchers see">
                <textarea
                  name="information"
                  rows={3}
                  maxLength={LIBRARY_LIMITS.text}
                  value={form.information}
                  onChange={(e) => update("information", e.target.value)}
                />
              </Field>
              <Field label="Cycling-off guidance · optional">
                <textarea
                  name="cyclingOff"
                  rows={2}
                  maxLength={LIBRARY_LIMITS.text}
                  value={form.cyclingOff}
                  onChange={(e) => update("cyclingOff", e.target.value)}
                />
              </Field>
              <Field label="Supporting supplement guidance · optional">
                <textarea
                  name="supplement"
                  rows={2}
                  maxLength={LIBRARY_LIMITS.text}
                  value={form.supplement}
                  onChange={(e) => update("supplement", e.target.value)}
                />
              </Field>
              <label className="app-lib-check">
                <input
                  type="checkbox"
                  name="available"
                  checked={form.available}
                  onChange={(e) => update("available", e.target.checked)}
                />
                Available for new cycles
              </label>
              {note ? <p className="app-lib-note">{note}</p> : null}
              <InlineError>{nameError ? undefined : error}</InlineError>
              <div className="app-lib-actions">
                <AppButton type="submit" saving={pending}>
                  Save
                </AppButton>
                <AppButton variant="secondary" onClick={() => setForm(null)}>
                  Cancel
                </AppButton>
              </div>
            </form>
          </section>
        ) : (
          <p className="app-lib-idle">Select an entry to edit it, or add a new peptide.</p>
        )}
      </div>
    </>
  );
}
