"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { isOnline } from "@/components/alpha/online";
import { Button } from "@/components/alpha/button";
import { Field, Switch, TextArea, TextInput } from "@/components/alpha/field";
import Link from "@/components/alpha/link";
import { ToastSlot, useAlphaToast } from "@/components/alpha/toast";
import { useIsLaptop } from "@/components/alpha/use-laptop";
import { useRefreshWait } from "@/components/alpha/use-refresh-wait";
import { savePeptideAction, type PeptideActionResult } from "@/app/(private)/admin/library/actions";
import {
  addStrength,
  type AdminPeptide,
  formOfPeptide,
  NAME_REQUIRED,
  NAME_TAKEN,
  newPeptideForm,
  type PeptideForm,
  type PeptideProblems,
  peptideProblems,
  peptideState,
  STATE_LINE,
  strengthLabel,
  SUMMARY_REQUIRED,
  usageNote,
} from "@/lib/library/admin";
import { type RecordAttempt, recordAttempt } from "@/lib/records/forms";
import { cn } from "@/lib/utils";
import { LIBRARY_PATH, peptidePath } from "./library-header";

const SAVE_UNSURE = "Couldn't confirm it was saved. Retry sends the same save, so nothing is saved twice.";

/**
 * A9 Edit peptide (phone: full screen over the tab bar) and D6's editor pane
 * (laptop). Save draft keeps a new or draft entry hidden from researchers;
 * Publish (Save and publish) needs the research summary. A published entry
 * never goes back to draft: turning Offered off is how it leaves new cycles.
 * Each save carries a request key (the same key while the entry is
 * unchanged, so a retry replays) and the version the editor opened; a save
 * over someone else's is refused and says who.
 */
export function PeptideEditor({ entry, takenNames }: { entry: AdminPeptide | null; takenNames: string[] }) {
  const router = useRouter();
  const toast = useAlphaToast();
  const refreshWait = useRefreshWait();
  const laptop = useIsLaptop();
  const [form, setForm] = useState<PeptideForm>(() => (entry ? formOfPeptide(entry) : newPeptideForm()));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  // A new entry was saved but its page never came: it exists, this page doesn't know its id (see save).
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const locked = saving !== null || reloadNeeded;
  // The attempt in flight or unanswered: a ref, so a toast's Retry (a closure from an earlier render) resends the same key.
  const pending = useRef<RecordAttempt | null>(null);
  const [notice, setNotice] = useState<{ message: string; changed?: boolean } | null>(null);
  const [serverProblems, setServerProblems] = useState<PeptideProblems>({});
  const [open, setOpen] = useState({ cyclingOff: Boolean(form.cyclingOff), supplement: Boolean(form.supplement) });

  const published = entry?.publishedAt != null;
  const state = entry ? peptideState(entry) : "draft";
  const nameTaken = takenNames.includes(form.name.trim().toLowerCase());
  const problemsFor = (publish: boolean): PeptideProblems => ({ ...peptideProblems(form, publish), ...(nameTaken ? { name: NAME_TAKEN } : {}) });
  const draftProblems = problemsFor(false);
  const publishProblems = problemsFor(true);
  const canDraft = !published && Object.keys(draftProblems).length === 0;
  const canPublish = Object.keys(publishProblems).length === 0;
  const summaryMissing = !form.information.trim();

  const shown: PeptideProblems = { ...draftProblems, ...serverProblems };
  if (shown.name === NAME_REQUIRED && !touched) delete shown.name;

  const set = <K extends keyof PeptideForm>(key: K, value: PeptideForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setServerProblems((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as keyof PeptideProblems];
      return next;
    });
  };

  async function save(publish: boolean) {
    // Offline, a save waits for the connection (the button is disabled; this covers Enter and keyboard submits).
    if (!isOnline()) return;
    if (reloadNeeded) return;
    setTouched(true);
    if (Object.keys(problemsFor(publish)).length) return;
    const submission = { ...form, publish };
    const attempt = recordAttempt(pending.current, submission, () => crypto.randomUUID());
    pending.current = attempt;
    setSaving(publish ? "publish" : "draft");
    setNotice(null);
    let result: PeptideActionResult;
    try {
      result = await savePeptideAction({ ...submission, requestKey: attempt.key });
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
      toast.success({ message: result.toast ?? "Saved." });
      if (laptop && entry && result.saved.version === entry.version) {
        setSaving(null);
        return;
      }
      const opening = !laptop ? LIBRARY_PATH : !entry ? peptidePath(result.saved.id) : null;
      refreshWait.start({
        lead: "Saved.",
        load: opening ? () => (laptop ? router.replace(opening) : router.push(opening)) : undefined,
        reloadTo: opening ?? undefined,
        onGiveUp: () => {
          setSaving(null);
          // A new entry: saving this form again would add a second one. It stays locked; Reload opens the saved entry.
          if (!entry) setReloadNeeded(true);
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
    if (result.problems) setServerProblems(result.problems);
    if (result.gone) {
      toast.error({ message: result.error ?? "This entry no longer exists." });
      router.push(LIBRARY_PATH);
      return;
    }
    setNotice({ message: result.error ?? "This entry could not be saved.", changed: result.changed });
  }

  const title = form.name.trim() || (entry ? entry.name : "New peptide");
  const stateTone = state === "draft" ? "text-low" : "text-ink-3";
  const saveLabel = published ? "Save and publish" : laptop ? "Publish" : "Save and publish";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-paper pt-[env(safe-area-inset-top)] laptop:sticky laptop:top-0 laptop:z-auto laptop:h-dvh laptop:pt-0"
      data-testid="peptide-editor"
      data-state={entry ? state : "new"}
    >
      <div className="grid h-11 flex-none grid-cols-[1fr_auto_1fr] items-center px-5 text-[17px] laptop:hidden">
        <Link href={LIBRARY_PATH} className="justify-self-start text-signal-ink">
          Cancel
        </Link>
        <span className="max-w-[220px] truncate font-semibold">{title}</span>
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" inert={locked}>
        <div className="flex items-end gap-3 px-5 pt-2 laptop:px-8 laptop:pt-6">
          <div className="min-w-0">
            <div className={cn("font-mono text-[13px] font-medium", stateTone)} data-testid="peptide-state-line">
              {entry ? STATE_LINE[state] : "New · not visible to researchers until published"}
            </div>
            <h2 className="mt-0.5 hidden truncate text-[28px] leading-[1.25] font-semibold tracking-[-0.025em] laptop:block">{title}</h2>
          </div>
          {entry ? (
            <Link href={`${peptidePath(entry.id)}/preview`} className="ml-auto hidden shrink-0 text-[14px] font-semibold laptop:block" data-testid="peptide-preview">
              Preview as researcher
            </Link>
          ) : null}
        </div>

        <form
          className="flex flex-col gap-3.5 px-4 pt-3 pb-6 laptop:grid laptop:grid-cols-2 laptop:gap-x-4 laptop:gap-y-3.5 laptop:px-8 laptop:pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save(published || !laptop);
          }}
        >
          <Field label="Name" error={shown.name}>
            <TextInput
              value={form.name}
              onChange={(event) => set("name", event.currentTarget.value)}
              onBlur={() => setTouched(true)}
              autoComplete="off"
              className="laptop:h-[46px] laptop:rounded-[12px] laptop:text-[15px]"
              data-testid="peptide-name"
            />
          </Field>

          <Strengths list={form.strengths} onChange={(list) => set("strengths", list)} error={shown.strengths} />

          <Field label="Short description" error={shown.shortDescription} className="laptop:col-span-2">
            <TextInput
              value={form.shortDescription}
              onChange={(event) => set("shortDescription", event.currentTarget.value)}
              placeholder="Shown under the name in the library"
              className="laptop:h-[46px] laptop:rounded-[12px] laptop:text-[15px]"
              data-testid="peptide-short"
            />
          </Field>

          <Field
            label={
              <span className="flex items-baseline justify-between gap-3">
                Research summary
                {summaryMissing ? (
                  <span className="text-missed" data-testid="summary-required">
                    {SUMMARY_REQUIRED}
                  </span>
                ) : null}
              </span>
            }
            error={shown.information}
            className="laptop:col-span-2"
          >
            <TextArea
              value={form.information}
              onChange={(event) => set("information", event.currentTarget.value)}
              placeholder="Researchers see this on the peptide page."
              className={cn(
                "h-[116px] text-base leading-[1.45] laptop:h-[150px] laptop:rounded-[12px] laptop:text-[15px]",
                summaryMissing && "border-missed shadow-[inset_0_0_0_1px_var(--missed)]",
              )}
              data-testid="peptide-summary-input"
            />
          </Field>

          <div className={cn("grid grid-cols-2 gap-2 laptop:hidden", open.cyclingOff && open.supplement && "hidden")}>
            {open.cyclingOff ? null : <OptionalButton label="Cycling off" onOpen={() => setOpen((o) => ({ ...o, cyclingOff: true }))} />}
            {open.supplement ? null : <OptionalButton label="Supplements" onOpen={() => setOpen((o) => ({ ...o, supplement: true }))} />}
          </div>
          <Field label="Cycling-off guidance" optional error={shown.cyclingOff} className={cn(!open.cyclingOff && "hidden laptop:flex")}>
            <TextArea
              value={form.cyclingOff}
              onChange={(event) => set("cyclingOff", event.currentTarget.value)}
              className="h-[88px] min-h-[88px] text-base laptop:rounded-[12px] laptop:text-[15px]"
              data-testid="peptide-cycling-off-input"
            />
          </Field>
          <Field label="Supplement guidance" optional error={shown.supplement} className={cn(!open.supplement && "hidden laptop:flex")}>
            <TextArea
              value={form.supplement}
              onChange={(event) => set("supplement", event.currentTarget.value)}
              className="h-[88px] min-h-[88px] text-base laptop:rounded-[12px] laptop:text-[15px]"
              data-testid="peptide-supplement-input"
            />
          </Field>

          <div className="rounded-now border border-line bg-surface px-3.5 py-3 laptop:hidden">
            <div className="flex items-center gap-3">
              <span id="offered-phone" className="flex-1 text-base font-semibold">
                Offered for new cycles
              </span>
              <Switch checked={form.offered} onCheckedChange={(on) => set("offered", on)} aria-labelledby="offered-phone" />
            </div>
            <p className="mt-1.5 text-[13px] text-ink-3" data-testid="usage-note">
              {usageNote(entry)}
            </p>
          </div>

          {entry ? (
            <Link href={`${peptidePath(entry.id)}/preview`} className="self-start text-[15px] font-semibold text-signal-ink laptop:hidden">
              Preview as researcher
            </Link>
          ) : null}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </div>

      <ToastSlot open footer />
      <footer className="flex-none border-t border-line bg-paper px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] laptop:px-8 laptop:py-4">
        {reloadNeeded ? (
          <p role="status" className="mb-3 text-[14px] font-medium text-ink-2" data-testid="peptide-reload-note">
            Saved. Reload to open it and keep editing.
          </p>
        ) : null}
        {notice ? (
          <div role="alert" className="mb-3 flex items-center gap-3 text-[14px] font-medium text-missed" data-testid="peptide-notice">
            <span className="min-w-0 flex-1">{notice.message}</span>
            {notice.changed ? (
              <Button variant="outline" size="sm" className="h-9 text-[14px]" onClick={() => router.refresh()}>
                Load latest
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <div className="hidden min-w-0 flex-1 items-center gap-3 laptop:flex">
            <Switch checked={form.offered} onCheckedChange={(on) => set("offered", on)} disabled={locked} aria-labelledby="offered-laptop" />
            <span className="min-w-0">
              <span id="offered-laptop" className="block text-[14px]">
                Offered for new cycles
              </span>
              <span className="block truncate text-[12px] text-ink-3" data-testid="usage-note-laptop">
                {usageNote(entry)}
              </span>
            </span>
          </div>
          {published ? null : (
            <Button needsConnection
              variant="outline"
              size="lg"
              className="laptop:h-11 laptop:rounded-[12px] laptop:px-4 laptop:text-[14px]"
              disabled={!canDraft || locked}
              saving={saving === "draft"}
              onClick={() => void save(false)}
              data-testid="save-draft"
            >
              Save draft
            </Button>
          )}
          <Button needsConnection
            variant="ink"
            size="lg"
            className="flex-1 laptop:h-11 laptop:flex-none laptop:rounded-[12px] laptop:px-[18px] laptop:text-[14px]"
            disabled={!canPublish || locked}
            saving={saving === "publish"}
            onClick={() => void save(true)}
            data-testid="save-publish"
          >
            {saveLabel}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function OptionalButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-12 items-center justify-between rounded-[14px] border border-line bg-surface pr-3 pl-3.5 text-[14px]"
    >
      {label}
      <span className="text-[12px] text-ink-3">optional</span>
    </button>
  );
}

/** Vial strengths: mono chips with ×, "+ Strength" opens a small mg field (Enter adds, Escape closes). */
function Strengths({ list, onChange, error }: { list: string[]; onChange: (list: string[]) => void; error?: string }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  const add = () => {
    if (!text.trim()) {
      setAdding(false);
      return;
    }
    const result = addStrength(list, text);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    onChange(result.list);
    setText("");
    setProblem(null);
    setAdding(false);
  };

  const shownError = problem ?? error ?? null;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" data-testid="strengths">
      <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Vial strengths</legend>
      <div className="flex flex-wrap gap-1.5">
        {list.map((mg) => (
          <span
            key={mg}
            className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface pr-1 pl-3 font-mono text-[14px] font-semibold laptop:h-[46px] laptop:rounded-[12px]"
            data-testid="strength-chip"
          >
            {strengthLabel(mg)}
            <button
              type="button"
              aria-label={`Remove ${strengthLabel(mg)}`}
              onClick={() => onChange(list.filter((item) => item !== mg))}
              className="flex size-8 items-center justify-center rounded-full text-ink-3"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        {adding ? (
          <span className="flex h-10 items-center gap-1 rounded-[10px] border border-ink bg-surface pr-1 pl-3 laptop:h-[46px] laptop:rounded-[12px]">
            <input
              ref={input}
              value={text}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(false);
                  setText("");
                  setProblem(null);
                }
              }}
              inputMode="decimal"
              aria-label="Strength in mg"
              placeholder="10"
              className="w-[72px] bg-transparent font-mono text-base font-semibold outline-none placeholder:text-ink-3 laptop:text-[14px]"
              data-testid="strength-input"
            />
            <span className="font-mono text-[13px] text-ink-3">mg</span>
            <button type="button" onClick={add} className="ml-1 h-8 rounded-[8px] bg-ink px-2.5 text-[13px] font-semibold text-surface" data-testid="strength-add">
              Add
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-10 items-center gap-1.5 rounded-[10px] border border-dashed border-ink-3 px-3 text-[14px] laptop:h-[46px] laptop:rounded-[12px]"
            data-testid="strength-new"
          >
            <Plus className="size-3.5" aria-hidden />
            Strength
          </button>
        )}
      </div>
      {shownError ? (
        <p role="alert" className="text-[13px] font-medium text-missed">
          {shownError}
        </p>
      ) : null}
    </fieldset>
  );
}
