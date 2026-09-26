"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveTemplateAction } from "@/app/(private)/admin/templates/actions";
import { TemplatePlanEditor } from "@/components/admin/template-plan-editor";
import { AppButton, EmptyState, Field, InlineError } from "@/components/app-shell/form";
import { useSubmit } from "@/components/app-shell/use-submit";
import {
  IDLE,
  NO_TEMPLATES,
  RECEIVE_HELPER,
  scopeNote,
  templateEditorTitle,
  templateMeta,
  TEMPLATES_SUBTITLE,
  templateSummary,
  templateUsage,
  templateWarning,
} from "@/lib/templates/display";
import {
  formOf,
  newPlan,
  TEMPLATE_LIMITS,
  type TemplateForm,
  type TemplatePeptide,
  type TemplateRecord,
} from "@/lib/templates/rules";
import "@/styles/app/library.css";
import "@/styles/app/templates.css";

const NEW_TEMPLATE: TemplateForm = { id: null, name: "", guidance: "", plans: [] };

/** A3: the template list (left) and the editor (right); stacked on phone. */
export function TemplatesView({ templates, peptides }: { templates: TemplateRecord[]; peptides: TemplatePeptide[] }) {
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [toAdd, setToAdd] = useState("");
  const { pending, error, setError, submit } = useSubmit(saveTemplateAction);
  const editorRef = useRef<HTMLElement>(null);
  const library = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide])), [peptides]);
  const editing = form !== null;

  // On phone the editor sits below the list: bring it into view when opened.
  useEffect(() => {
    if (editing && window.matchMedia("(max-width: 759.98px)").matches) {
      editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [editing, form?.id]);

  // Available peptides not in the template yet (a peptide appears once).
  const addable = peptides.filter((peptide) => peptide.available && !form?.plans.some((plan) => plan.peptideId === peptide.id));
  const selected = addable.some((peptide) => peptide.id === toAdd) ? toAdd : (addable[0]?.id ?? "");

  function open(next: TemplateForm) {
    setError(undefined);
    setToAdd("");
    setForm(next);
  }

  function update(patch: Partial<TemplateForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <>
      <div className="app-lib-head">
        <div>
          <h1 className="app-h1">Cycle templates</h1>
          <p className="app-subtitle">{TEMPLATES_SUBTITLE}</p>
        </div>
        <AppButton size="sm" onClick={() => open(NEW_TEMPLATE)}>
          New template
        </AppButton>
      </div>

      <div className="app-lib">
        <div className="app-lib-list">
          {templates.length === 0 ? <EmptyState>{NO_TEMPLATES}</EmptyState> : null}
          {templates.map((template) => {
            const isSelected = form?.id === template.id;
            const warning = templateWarning(template, library);
            return (
              <button
                key={template.id}
                type="button"
                className="app-tpl-row"
                data-testid="template-row"
                data-selected={isSelected || undefined}
                aria-current={isSelected || undefined}
                onClick={() => open(formOf(template))}
              >
                <span className="app-tpl-row-top">
                  <b className="app-tpl-row-name">{template.name}</b>
                  <span className="app-tpl-row-meta">{templateMeta(template)}</span>
                </span>
                <span className="app-tpl-row-line app-tpl-row-summary">{templateSummary(template, library)}</span>
                {warning ? <span className="app-tpl-row-line app-tpl-row-warn">{warning}</span> : null}
                <span className="app-tpl-row-line">{templateUsage(template.cycleCount)}</span>
              </button>
            );
          })}
        </div>

        {form ? (
          <section ref={editorRef} className="app-card app-lib-editor" aria-labelledby="template-editor-title">
            <h2 id="template-editor-title" className="app-card-title">
              {templateEditorTitle(form.id === null, form.name)}
            </h2>
            <form
              noValidate
              className="app-lib-fields"
              onSubmit={(event) => {
                event.preventDefault();
                submit(form, (result) => {
                  if (result.saved) setForm(null);
                });
              }}
            >
              <Field label="Name">
                <input
                  name="name"
                  autoComplete="off"
                  maxLength={TEMPLATE_LIMITS.name}
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </Field>
              <Field label="Guidance shown with the template · optional">
                <textarea
                  name="guidance"
                  rows={2}
                  maxLength={TEMPLATE_LIMITS.guidance}
                  value={form.guidance}
                  onChange={(e) => update({ guidance: e.target.value })}
                />
              </Field>
              <div>
                <div className="app-tpl-section-label">What researchers receive</div>
                <p className="app-tpl-helper">{RECEIVE_HELPER}</p>
                {form.plans.map((plan, index) => (
                  <TemplatePlanEditor
                    key={plan.peptideId}
                    name={library.get(plan.peptideId)?.name ?? "Unknown peptide"}
                    plan={plan}
                    onChange={(next) => update({ plans: form.plans.map((p, j) => (j === index ? next : p)) })}
                    onRemove={() => update({ plans: form.plans.filter((_, j) => j !== index) })}
                  />
                ))}
                <div className="app-tpl-add">
                  <select
                    aria-label="Peptide to add"
                    value={selected}
                    disabled={addable.length === 0}
                    onChange={(e) => setToAdd(e.target.value)}
                  >
                    {addable.map((peptide) => (
                      <option key={peptide.id} value={peptide.id}>
                        {peptide.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="app-tpl-small-btn"
                    disabled={!selected}
                    onClick={() => update({ plans: [...form.plans, newPlan(selected)] })}
                  >
                    + Add peptide
                  </button>
                </div>
              </div>
              <InlineError>{error}</InlineError>
              <div className="app-lib-actions">
                <AppButton type="submit" saving={pending}>
                  Save template
                </AppButton>
                <AppButton variant="secondary" onClick={() => setForm(null)}>
                  Cancel
                </AppButton>
              </div>
              <p className="app-tpl-scope">{scopeNote(form.id === null)}</p>
            </form>
          </section>
        ) : (
          <p className="app-lib-idle">{IDLE}</p>
        )}
      </div>
    </>
  );
}
