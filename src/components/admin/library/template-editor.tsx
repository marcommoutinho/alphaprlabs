"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { isOnline } from "@/components/alpha/online";
import { Button } from "@/components/alpha/button";
import { Notice } from "@/components/alpha/notice";
import { Field, TextInput } from "@/components/alpha/field";
import Link from "@/components/alpha/link";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { Tag } from "@/components/alpha/tag";
import { ToastSlot, useAlphaToast } from "@/components/alpha/toast";
import { useIsLaptop } from "@/components/alpha/use-laptop";
import { useRefreshWait } from "@/components/alpha/use-refresh-wait";
import { Issues } from "@/components/research/cycles/builder/parts";
import { AxisRow } from "@/components/research/cycles/lanes";
import { saveTemplateAction, type TemplateActionResult } from "@/app/(private)/admin/library/templates/actions";
import { ADMIN_TEMPLATE_CHECKLIST } from "@/lib/auth/terms";
import { barHeight } from "@/lib/cycles/geometry";
import { STATE_LINE } from "@/lib/library/admin";
import { type RecordAttempt, recordAttempt } from "@/lib/records/forms";
import type { Weekday } from "@/lib/schedule/engine";
import {
  draftPlans,
  editorMeta,
  footerNote,
  formOfRow,
  type Frequency,
  GUIDANCE_LABEL,
  laneAxis,
  newRow,
  type PhaseRow,
  rowOfPhase,
  templateLanes,
  WEEKDAY_TOGGLES,
  withdrawnNotice,
} from "@/lib/templates/display";
import { formOf, type TemplatePeptide, type TemplateRecord, validateTemplate } from "@/lib/templates/rules";
import { cn } from "@/lib/utils";
import { TEMPLATES_PATH, templatePath } from "./library-header";

const SAVE_UNSURE = "Couldn't confirm it was saved. Retry sends the same save, so nothing is saved twice.";
const HATCH = "repeating-linear-gradient(135deg, var(--line) 0 1.5px, transparent 1.5px 6px)";

type DraftPlan = { key: string; peptideId: string; rows: PhaseRow[] };

let nextKey = 0;
const freshKey = () => `k${++nextKey}`;

/**
 * D7 Template editor (phone: full screen over the tab bar): name and
 * guidance, the timeline of every peptide's lane on one day axis, and a card
 * per peptide with its phases (+ Phase, + Break, Remove). Each peptide
 * appears once. A peptide no longer offered stays in a template that has it
 * and can be saved with it, but can't be added (Marco, 2026-09-26). The
 * shared validation (src/lib/templates/rules.ts) runs as it is edited; a
 * save waits until it passes. Save draft keeps a new or draft template
 * hidden from researchers; Publish (Save and publish) shows it to them;
 * Move to draft hides a published one again (Marco, 2026-09-30: the
 * template draft stage). Draft and publish run the same rules: the
 * difference is visibility only. Cycles already started from it never
 * change. A save carries a request key and the version the editor opened;
 * a save over someone else's is refused.
 */
export function TemplateEditor({ template, peptides }: { template: TemplateRecord | null; peptides: TemplatePeptide[] }) {
  const router = useRouter();
  const toast = useAlphaToast();
  const refreshWait = useRefreshWait();
  const laptop = useIsLaptop();
  const byId = useMemo(() => new Map(peptides.map((peptide) => [peptide.id, peptide])), [peptides]);
  const kept = useMemo(() => new Set(template?.plans.map((plan) => plan.peptideId) ?? []), [template]);
  const [name, setName] = useState(template?.name ?? "");
  const [guidance, setGuidance] = useState(template?.guidance ?? "");
  const [plans, setPlans] = useState<DraftPlan[]>(() =>
    template ? formOf(template).plans.map((plan) => ({ key: freshKey(), peptideId: plan.peptideId, rows: plan.phases.map((phase) => rowOfPhase(phase, freshKey())) })) : [],
  );
  const [touched, setTouched] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  // A new template was saved but its page never came: it exists, this page doesn't know its id (see save).
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const locked = saving !== null || reloadNeeded;
  const published = template?.publishedAt != null;
  const [notice, setNotice] = useState<{ message: string; changed?: boolean } | null>(null);
  const pending = useRef<RecordAttempt | null>(null);

  const form = {
    id: template?.id ?? null,
    version: template?.version ?? null,
    name,
    guidance,
    plans: plans.map((plan) => ({ peptideId: plan.peptideId, phases: plan.rows.map(formOfRow) })),
  };
  const validation = validateTemplate(form, peptides, kept);
  const issues = validation.ok ? [] : validation.errors;
  const drafted = draftPlans(plans);
  const { total, lanes } = templateLanes({ plans: drafted });
  const axis = laneAxis(lanes, total);
  const notOffered = withdrawnNotice({ plans: drafted }, byId);
  const addable = peptides.filter((peptide) => peptide.available && !plans.some((plan) => plan.peptideId === peptide.id)).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  const edit = (fn: (plans: DraftPlan[]) => DraftPlan[]) => {
    setTouched(true);
    setPlans(fn);
  };
  const editRow = (planKey: string, rowKey: string, patch: Partial<PhaseRow>) =>
    edit((all) => all.map((plan) => (plan.key !== planKey ? plan : { ...plan, rows: plan.rows.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)) })));

  /** `publish`: the state it is left in (true published, false a draft). */
  async function save(publish: boolean) {
    // Offline, a save waits for the connection (the button is disabled; this covers Enter and keyboard submits).
    if (!isOnline()) return;
    if (reloadNeeded) return;
    setTouched(true);
    if (!validation.ok) {
      setIssuesOpen(true);
      return;
    }
    const submission = { ...form, publish };
    const attempt = recordAttempt(pending.current, submission, () => crypto.randomUUID());
    pending.current = attempt;
    setSaving(publish ? "publish" : "draft");
    setNotice(null);
    let result: TemplateActionResult;
    try {
      result = await saveTemplateAction({ ...submission, requestKey: attempt.key });
    } catch {
      result = { error: SAVE_UNSURE, unsure: true };
    }
    if (result.saved) {
      // Still saving (the form inert) while this editor is being replaced:
      // the action answers before the refreshed page arrives, and that page
      // remounts the editor at the new version (or another page opens), so
      // anything typed in between would be silently dropped. An unchanged
      // save keeps the version: nothing replaces the editor. The wait is
      // bounded (useRefreshWait): if that page never comes, the form is
      // usable again and the toast says it shows the version from before.
      pending.current = null;
      toast.success({ message: result.toast ?? "Template saved." });
      if (laptop && template && result.saved.version === template.version) {
        setSaving(null);
        return;
      }
      const opening = !laptop ? TEMPLATES_PATH : !template ? templatePath(result.saved.id) : null;
      refreshWait.start({
        lead: "Saved.",
        load: opening ? () => (laptop ? router.replace(opening) : router.push(opening)) : undefined,
        reloadTo: opening ?? undefined,
        onGiveUp: () => {
          setSaving(null);
          // A new template: saving this form again would add a second one. It stays locked; Reload opens the saved template.
          if (!template) setReloadNeeded(true);
        },
      });
      return;
    }
    setSaving(null);
    if (result.unsure) {
      toast.error({ message: result.error ?? SAVE_UNSURE, action: { label: "Retry", onAction: () => void save(publish) } });
      return;
    }
    pending.current = null;
    if (result.gone) {
      toast.error({ message: result.error ?? "This template no longer exists." });
      router.push(TEMPLATES_PATH);
      return;
    }
    setNotice({ message: result.error ?? "This template could not be saved.", changed: result.changed });
  }

  const title = name.trim() || template?.name || "New template";
  const saveLabel = published ? "Save and publish" : laptop ? "Publish" : "Save and publish";
  const note = footerNote(template);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-paper pt-[env(safe-area-inset-top)] laptop:static laptop:z-auto laptop:min-h-dvh laptop:pt-0"
      data-testid="template-editor"
      data-state={template ? (published ? "published" : "draft") : "new"}
    >
      <div className="grid h-11 flex-none grid-cols-[1fr_auto_1fr] items-center px-5 text-[17px] laptop:hidden">
        <Link href={TEMPLATES_PATH} className="justify-self-start text-signal-ink">
          Cancel
        </Link>
        {/* The phone's page heading (the laptop header below is hidden here). */}
        <h1 className="max-w-[220px] truncate font-semibold">{title}</h1>
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 laptop:overflow-visible" inert={locked}>
        <header className="px-5 pt-1 laptop:px-9 laptop:pt-6">
          <Link href={TEMPLATES_PATH} className="hidden text-[14px] text-signal-ink laptop:inline">
            ‹ Templates
          </Link>
          {/* The peptide editor's state lines: a new template or a draft is hidden from researchers. */}
          {published ? null : (
            <div className="font-mono text-[13px] font-medium text-low laptop:mt-1" data-testid="template-state-line">
              {template ? STATE_LINE.draft : "New · not visible to researchers until published"}
            </div>
          )}
          <h1 className="mt-1 hidden truncate text-[30px] leading-[1.15] font-semibold tracking-[-0.025em] laptop:block">{title}</h1>
          {template ? (
            <div className="font-mono text-[13px] font-medium text-ink-3 laptop:mt-0.5" data-testid="template-meta">
              {editorMeta(template)}
            </div>
          ) : null}
        </header>

        <div className="flex flex-col gap-3.5 px-4 pt-3 laptop:grid laptop:grid-cols-[1fr_1.4fr] laptop:gap-4 laptop:px-9 laptop:pt-4">
          <Field label="Name">
            <TextInput
              compact
              value={name}
              onChange={(event) => {
                setTouched(true);
                setName(event.currentTarget.value);
              }}
              autoComplete="off"
              className="bg-surface"
              data-testid="template-name"
            />
          </Field>
          <div className="flex flex-col gap-2.5">
            <Field label={GUIDANCE_LABEL} optional>
              <TextInput compact value={guidance} onChange={(event) => setGuidance(event.currentTarget.value)} autoComplete="off" data-testid="template-guidance" />
            </Field>
            <Notice testId="template-writing-rules">
              <p className="font-semibold text-ink">{ADMIN_TEMPLATE_CHECKLIST.title}</p>
              <ul className="mt-1 list-disc pl-4">
                {ADMIN_TEMPLATE_CHECKLIST.items.map((item) => (
                  <li key={item} className="mt-0.5">
                    {item}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        </div>

        {plans.length ? (
          <section aria-label="Timeline" className="mx-3 mt-4 rounded-group border border-line bg-surface px-4 py-3.5 laptop:mx-9 laptop:px-5" data-testid="template-timeline">
            <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 laptop:grid-cols-[120px_minmax(0,1fr)]">
              <span />
              <AxisRow labels={axis} />
              {plans.map((plan, i) => {
                const lane = lanes[i];
                const peptide = byId.get(plan.peptideId);
                return (
                  <span key={plan.key} className="contents">
                    <span className={cn("truncate text-[14px] font-semibold", !peptide?.available && "text-ink-2")}>{peptide?.name ?? "Unknown peptide"}</span>
                    <span className="relative h-[22px]" aria-hidden>
                      {lane?.bars.map((bar, j) => (
                        <i
                          key={j}
                          className={cn("absolute bottom-0 rounded-[6px]", bar.kind === "active" ? "bg-ink" : "border border-ink-3")}
                          style={{
                            left: `${bar.left}%`,
                            width: `max(3px, calc(${bar.width}% - 3px))`,
                            height: barHeight(bar, { min: 12, max: 22, equal: 22 }),
                            ...(bar.kind === "break" ? { background: HATCH } : {}),
                          }}
                        />
                      ))}
                    </span>
                  </span>
                );
              })}
            </div>
          </section>
        ) : null}

        {notOffered ? (
          <p className="mx-5 mt-3 text-[13px] font-medium text-low laptop:mx-9" data-testid="template-withdrawn-notice">
            {notOffered}
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3 px-3 laptop:px-9">
          {plans.map((plan) => (
            <PeptideCard
              key={plan.key}
              plan={plan}
              peptide={byId.get(plan.peptideId)}
              onAdd={(kind) => edit((all) => all.map((p) => (p.key === plan.key ? { ...p, rows: [...p.rows, newRow(kind, p.rows, freshKey())] } : p)))}
              onRemove={() => edit((all) => all.filter((p) => p.key !== plan.key))}
              onRemoveRow={(rowKey) => edit((all) => all.map((p) => (p.key === plan.key ? { ...p, rows: p.rows.filter((row) => row.key !== rowKey) } : p)))}
              onEditRow={(rowKey, patch) => editRow(plan.key, rowKey, patch)}
            />
          ))}
          {plans.length === 0 ? (
            <div className="rounded-group border border-dashed border-ink-3 px-5 py-6 text-center">
              <p className="text-[15px] text-ink-2">Add the peptides researchers start with. Each one gets its own phases.</p>
            </div>
          ) : null}
          <Button variant="outline" size="md" className="self-start text-[14px] laptop:hidden" onClick={() => setPicking(true)} data-testid="add-peptide-phone">
            + Add peptide
          </Button>
        </div>
      </div>

      <ToastSlot open footer />
      <footer className="flex-none border-t border-line bg-paper px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] laptop:sticky laptop:bottom-0 laptop:px-9 laptop:py-3.5">
        {touched && issues.length ? (
          <div className="mb-3">
            <Issues issues={issues} open={issuesOpen} onOpenChange={setIssuesOpen} />
          </div>
        ) : null}
        {reloadNeeded ? (
          <p role="status" className="mb-3 text-[14px] font-medium text-ink-2" data-testid="template-reload-note">
            Saved. Reload to open it and keep editing.
          </p>
        ) : null}
        {notice ? (
          <div role="alert" className="mb-3 flex items-center gap-3 text-[14px] font-medium text-missed" data-testid="template-notice">
            <span className="min-w-0 flex-1">{notice.message}</span>
            {notice.changed ? (
              <Button variant="outline" size="sm" className="h-9 text-[14px]" onClick={() => router.refresh()}>
                Load latest
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <span className="hidden min-w-0 flex-1 text-[13px] text-ink-2 laptop:block" data-testid="template-footer-note">
            {note}
          </span>
          <Button
            variant="outline"
            size="md"
            className="hidden text-[14px] laptop:inline-flex"
            disabled={locked}
            onClick={() => setPicking(true)}
            data-testid="add-peptide"
          >
            + Add peptide
          </Button>
          {/* The peptide editor's footer: Save draft (Move to draft once published) and Publish (Save and publish). */}
          <Button needsConnection
            variant="outline"
            size="lg"
            className="laptop:h-11 laptop:rounded-[12px] laptop:px-4 laptop:text-[14px]"
            disabled={locked || (touched && !validation.ok)}
            saving={saving === "draft"}
            onClick={() => void save(false)}
            data-testid={published ? "move-to-draft" : "save-draft"}
          >
            {published ? "Move to draft" : "Save draft"}
          </Button>
          <Button needsConnection
            variant="ink"
            size="lg"
            className="flex-1 laptop:h-11 laptop:flex-none laptop:rounded-[12px] laptop:px-[18px] laptop:text-[14px]"
            disabled={locked || (touched && !validation.ok)}
            saving={saving === "publish"}
            onClick={() => void save(true)}
            data-testid="save-publish"
          >
            {saveLabel}
          </Button>
        </div>
        {note ? <p className="mt-2 text-[12px] text-ink-3 laptop:hidden">{note}</p> : null}
      </footer>

      <Sheet open={picking} onOpenChange={setPicking}>
        <SheetContent title="Add a peptide" context="Offered peptides not in this template" size="auto">
          <div className="px-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
            {addable.length ? (
              <ul className="divide-y divide-line overflow-hidden rounded-group border border-line bg-surface" data-testid="peptide-picker">
                {addable.map((peptide) => (
                  <li key={peptide.id}>
                    <button
                      type="button"
                      className="flex h-[52px] w-full items-center px-4 text-left text-base font-semibold"
                      onClick={() => {
                        edit((all) => [...all, { key: freshKey(), peptideId: peptide.id, rows: [newRow("active", [], freshKey())] }]);
                        setPicking(false);
                      }}
                    >
                      {peptide.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 text-[15px] text-ink-2">Every offered peptide is already in this template.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const ROW_GRID = "laptop:grid-cols-[90px_110px_140px_minmax(0,1.3fr)_minmax(0,1fr)]";

function PeptideCard({
  plan,
  peptide,
  onAdd,
  onRemove,
  onRemoveRow,
  onEditRow,
}: {
  plan: DraftPlan;
  peptide: TemplatePeptide | undefined;
  onAdd: (kind: "active" | "break") => void;
  onRemove: () => void;
  onRemoveRow: (rowKey: string) => void;
  onEditRow: (rowKey: string, patch: Partial<PhaseRow>) => void;
}) {
  const name = peptide?.name ?? "Unknown peptide";
  return (
    <section aria-label={name} className="rounded-group border border-line bg-surface px-4 py-3 laptop:px-5" data-testid="template-peptide">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          {name}
          {peptide?.available ? null : <Tag tone="outline">Not offered</Tag>}
        </h3>
        <span className="flex gap-3.5 text-[14px] font-semibold">
          <button type="button" className="text-signal-ink" onClick={() => onAdd("active")} data-testid="add-phase">
            + Phase
          </button>
          <button type="button" className="text-signal-ink" onClick={() => onAdd("break")} data-testid="add-break">
            + Break
          </button>
          <button type="button" className="text-missed" onClick={onRemove} data-testid="remove-peptide">
            Remove
          </button>
        </span>
      </div>
      <div className={cn("mt-1 hidden gap-3 border-b border-line pt-2.5 pb-1.5 text-[12px] text-ink-3 laptop:grid", ROW_GRID)} aria-hidden>
        <span>Phase</span>
        <span>Days</span>
        <span>Dose</span>
        <span>Schedule</span>
        <span>Time</span>
      </div>
      {plan.rows.length === 0 ? <p className="py-3 text-[14px] text-ink-2">No phases yet. Add one.</p> : null}
      {plan.rows.map((row, i) => (
        <PhaseRowView key={row.key} row={row} index={i} peptide={name} onChange={(patch) => onEditRow(row.key, patch)} onRemove={() => onRemoveRow(row.key)} />
      ))}
    </section>
  );
}

const BOX = "flex h-9 items-center rounded-[10px] border border-line bg-surface px-2.5 font-mono text-base font-medium laptop:text-[13px] focus-within:border-ink focus-within:shadow-[inset_0_0_0_1px_var(--ink)]";
const BARE = "min-w-0 bg-transparent outline-none";

function PhaseRowView({ row, index, peptide, onChange, onRemove }: { row: PhaseRow; index: number; peptide: string; onChange: (patch: Partial<PhaseRow>) => void; onRemove: () => void }) {
  const label = `${peptide}, phase ${index + 1}`;
  const active = row.kind === "active";
  const toggleDay = (day: Weekday) => onChange({ days: row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) });
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("grid grid-cols-2 items-center gap-x-3 gap-y-2 border-b border-line py-2.5 text-[14px] last:border-b-0 laptop:gap-y-0 laptop:py-1.5", ROW_GRID, !active && "text-ink-2")}
      data-testid="phase-row"
      data-kind={row.kind}
    >
      <span className="col-span-2 flex items-center gap-1.5 font-semibold laptop:col-span-1">
        {active ? "Active" : "Break"}
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="flex size-7 items-center justify-center rounded-full text-ink-3" data-testid="remove-phase">
          <X className="size-3.5" aria-hidden />
        </button>
      </span>
      <label className={cn(BOX, "col-span-2 gap-1 laptop:col-span-1", !active && "border-dashed border-ink-3")}>
        <span className="mr-1 font-sans text-[12px] text-ink-3 laptop:sr-only">Days</span>
        <input aria-label={`${label}: first day`} inputMode="numeric" value={row.from} onChange={(e) => onChange({ from: e.currentTarget.value })} className={cn(BARE, "w-10 text-center")} data-testid="phase-from" />
        <span aria-hidden>–</span>
        <input aria-label={`${label}: last day`} inputMode="numeric" value={row.to} onChange={(e) => onChange({ to: e.currentTarget.value })} className={cn(BARE, "w-10 text-center")} data-testid="phase-to" />
      </label>
      {active ? (
        <>
          <label className={cn(BOX, "gap-1")}>
            <span className="sr-only">{label}: dose</span>
            <input inputMode="decimal" value={row.amount} placeholder="250" onChange={(e) => onChange({ amount: e.currentTarget.value })} className={cn(BARE, "w-full")} data-testid="phase-dose" />
            <select
              aria-label={`${label}: dose unit`}
              value={row.unit}
              onChange={(e) => onChange({ unit: e.currentTarget.value as PhaseRow["unit"] })}
              className="bg-transparent text-ink-2 outline-none"
              data-testid="phase-unit"
            >
              <option value="mcg">mcg</option>
              <option value="mg">mg</option>
            </select>
          </label>
          <label className={cn(BOX, "laptop:order-last")}>
            <span className="sr-only">{label}: time</span>
            <input type="time" value={row.time} onChange={(e) => onChange({ time: e.currentTarget.value })} className={cn(BARE, "w-full")} data-testid="phase-time" />
          </label>
          <div className="col-span-2 flex flex-col gap-1.5 laptop:col-span-1">
            <div className="flex items-center gap-2">
              <select
                aria-label={`${label}: schedule`}
                value={row.frequency}
                onChange={(e) => {
                  const frequency = e.currentTarget.value as Frequency;
                  onChange({ frequency, every: frequency === "every" && row.every.trim() === "1" ? "2" : row.every });
                }}
                className="h-9 min-w-0 rounded-[10px] border border-line bg-surface px-2 text-base laptop:text-[14px]"
                data-testid="phase-schedule"
              >
                <option value="daily">Daily</option>
                <option value="every">Every N days</option>
                <option value="weekdays">Weekdays</option>
              </select>
              {row.frequency === "every" ? (
                <label className={cn(BOX, "w-[88px] gap-1")}>
                  <input aria-label={`${label}: every how many days`} inputMode="numeric" value={row.every} onChange={(e) => onChange({ every: e.currentTarget.value })} className={cn(BARE, "w-8 text-center")} data-testid="phase-every" />
                  <span className="font-sans text-[12px] text-ink-3">days</span>
                </label>
              ) : null}
            </div>
            {row.frequency === "weekdays" ? (
              <div className="flex gap-1" role="group" aria-label={`${label}: days of the week`}>
                {WEEKDAY_TOGGLES.map((day) => {
                  const on = row.days.includes(day.day as Weekday);
                  return (
                    <button
                      key={day.day}
                      type="button"
                      aria-pressed={on}
                      aria-label={day.label}
                      onClick={() => toggleDay(day.day as Weekday)}
                      className={cn("flex size-[30px] items-center justify-center rounded-[8px] text-[12px]", on ? "bg-ink font-semibold text-surface" : "border border-line font-medium")}
                    >
                      {day.letter}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <span className="hidden laptop:block">—</span>
          <span className="hidden laptop:block">—</span>
          <span className="hidden laptop:block">—</span>
        </>
      )}
    </div>
  );
}
