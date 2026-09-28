"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { correctVialAction, finishVialAction, reopenVialAction, saveVialAction } from "@/app/(private)/app/supplies/actions";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { Field, NumberInput, TextInput } from "@/components/alpha/field";
import { LevelMeter } from "@/components/alpha/gauges";
import { Segmented } from "@/components/alpha/segmented";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { Tag } from "@/components/alpha/tag";
import { inMassUnit, type MassUnit, massUnit, mgFromUnit } from "@/lib/alpha/format";
import type { MixtureOption, SuppliesView, UnopenedGroup, VialCard } from "@/lib/supplies/view";
import { cn } from "@/lib/utils";
import { useRequestKey, useSheetAction } from "./supplies-shared";
import { vialName } from "@/lib/supplies/name";

const NOT_MIXED = "";

/** "Compound A · 8 mg / 2 mL · 1 mL — vial A-01 open" (a mixture takes one open vial). */
const optionLabel = (mixture: MixtureOption) => `${mixture.label}${mixture.openVial ? ` — ${vialName(mixture.openVial, true)} open` : ""}`;

/** A native select in the v3 field frame. */
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <span className="relative flex">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-[52px] w-full cursor-pointer appearance-none rounded-[14px] border border-line bg-surface pr-10 pl-3.5 text-base text-ink focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--ink)] focus-visible:outline-none"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-ink-3" aria-hidden />
      </span>
    </label>
  );
}

function InlineError({ children }: { children: string | null }) {
  return children ? (
    <p role="alert" className="mx-2 text-[14px] font-medium text-missed">
      {children}
    </p>
  ) : null;
}

/**
 * R7's round + "Add vial": an optional label ("Vial N" when blank), the
 * saved mixture it was mixed to (its peptide and strength come with it), or
 * "Not mixed yet" with the peptide and strength. One vial per request key.
 */
export function AddVialSheet({ open, view, onClose }: { open: boolean; view: SuppliesView; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      {open ? <AddVialBody key={view.labels.length} view={view} onClose={onClose} /> : null}
    </Sheet>
  );
}

function AddVialBody({ view, onClose }: { view: SuppliesView; onClose: () => void }) {
  const save = useSheetAction(saveVialAction);
  const request = useRequestKey();
  const firstFree = view.mixtures.find((mixture) => !mixture.openVial)?.id ?? NOT_MIXED;
  const [label, setLabel] = useState("");
  const [mixtureId, setMixtureId] = useState(firstFree);
  const [peptideId, setPeptideId] = useState("");
  const [strength, setStrength] = useState("");
  const mixture = view.mixtures.find((m) => m.id === mixtureId) ?? null;
  const submit = () => {
    const form = {
      id: null,
      label,
      mixtureId: mixture?.id ?? null,
      peptideId: mixture ? mixture.peptideId : peptideId,
      strengthMg: mixture ? mixture.strengthMg : strength,
    };
    save.run({ ...form, requestKey: request.keyFor(form) }, () => {
      request.done();
      onClose();
    });
  };
  return (
    <SheetContent
      title="Add vial"
      size="auto"
      footer={
        <Button size="lg" block saving={save.pending} onClick={submit} data-testid="add-vial-submit">
          Add vial
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3.5 px-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Your label" optional description="Blank names it Vial N.">
          <TextInput compact value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. A-02" maxLength={40} />
        </Field>
        <Select label="Saved mixture" value={mixtureId} onChange={setMixtureId}>
          <option value={NOT_MIXED}>Not mixed yet</option>
          {view.mixtures.map((m) => (
            <option key={m.id} value={m.id} disabled={m.openVial !== null}>
              {optionLabel(m)}
            </option>
          ))}
        </Select>
        {mixture ? (
          <p className="text-[14px] text-ink-2" data-testid="add-strength">
            {mixture.strengthMg} mg · from the mixture
          </p>
        ) : (
          <>
            <Select label="Peptide" value={peptideId} onChange={setPeptideId}>
              <option value="">Choose…</option>
              {view.peptides.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Field label="Strength">
              <NumberInput value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 10" unit="mg" aria-label="Strength (mg)" />
            </Field>
          </>
        )}
        {view.mixtures.length === 0 ? <p className="text-[13px] text-ink-3">Save a mixture in the calculator to link a vial to it.</p> : null}
        <button type="submit" hidden />
      </form>
      <InlineError>{save.error}</InlineError>
    </SheetContent>
  );
}

/** Several unopened vials of one kind: pick the one to open. */
export function UnopenedSheet({ group, onClose, onPick }: { group: UnopenedGroup | null; onClose: () => void; onPick: (id: string) => void }) {
  return (
    <Sheet open={group !== null} onOpenChange={(next) => (next ? null : onClose())}>
      {group ? (
        <SheetContent title={group.title} context={`Unopened · ${group.vials.length}`} size="auto">
          <div className="divide-y divide-line overflow-hidden rounded-group border border-line bg-surface">
            {group.vials.map((vial) => (
              <button key={vial.id} type="button" className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left" onClick={() => onPick(vial.id)}>
                <span className="min-w-0 flex-1 font-mono text-[13px] text-ink-2">{vial.meta}</span>
                <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
              </button>
            ))}
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

/**
 * A vial's sheet (R7 "Tap a vial to correct it or mark it finished"): what's
 * left and how far it goes, "Correct remaining", its label and mixture, its
 * history (doses and corrections, each dose linking to its record), and
 * Mark finished (asks first) or, once finished, Reopen.
 */
export function VialSheet({ vial, view, onClose }: { vial: VialCard | null; view: SuppliesView; onClose: () => void }) {
  return (
    <Sheet open={vial !== null} onOpenChange={(next) => (next ? null : onClose())}>
      {vial ? <VialBody key={vial.id} vial={vial} view={view} onClose={onClose} /> : null}
    </Sheet>
  );
}

function VialBody({ vial, view, onClose }: { vial: VialCard; view: SuppliesView; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const finish = useSheetAction(finishVialAction);
  const reopen = useSheetAction(reopenVialAction);
  const low = vial.tag !== null;

  const footer = !vial.open ? (
    <Button size="lg" variant="ink" block saving={reopen.pending} onClick={() => reopen.run({ id: vial.id, label: vial.label }, onClose)}>
      Reopen
    </Button>
  ) : confirming ? (
    <>
      <Button size="lg" variant="outline" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button size="lg" variant="ink" saving={finish.pending} onClick={() => finish.run({ id: vial.id, label: vial.label }, onClose)} data-testid="finish-confirm">
        Finish vial
      </Button>
    </>
  ) : (
    <Button size="lg" variant="destructive-text" block onClick={() => setConfirming(true)}>
      Mark finished
    </Button>
  );

  return (
    <SheetContent title={vial.title} context={vial.meta} footer={footer}>
      {confirming ? (
        <p role="alert" className="mx-2 rounded-[14px] bg-sunken px-3.5 py-3 text-[14px] leading-5 text-ink-2">
          Finish {vialName(vial.label, true)}? It moves to finished with its history. Confirmed doses stop deducting from it, and its mixture can take a new vial. You can
          reopen it.
        </p>
      ) : null}

      <section aria-label="Remaining" className="rounded-group border border-line bg-surface p-4" data-testid="vial-sheet" data-open={vial.open}>
        <div className="flex items-center justify-between gap-3">
          <span className={cn("text-[28px] leading-none font-semibold tracking-[-0.025em]", low && "text-low")} data-testid="vial-sheet-left">
            {vial.left}
          </span>
          {vial.tag ? <Tag tone="low">{vial.tag}</Tag> : null}
        </div>
        <LevelMeter value={vial.percent / 100} low={low} label={`${vialName(vial.label)} remaining`} className="mt-3" />
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[14px]">
          <dt className="text-ink-3">State</dt>
          <dd data-testid="vial-state" data-tone={vial.tone}>
            {vial.finished ? `${vial.state} · ${vial.finished}` : vial.state}
          </dd>
          <dt className="text-ink-3">Estimate</dt>
          <dd className="font-semibold" data-testid="vial-remaining">
            {vial.remaining}
          </dd>
          <dt className="text-ink-3">Used</dt>
          <dd data-testid="vial-uses">{vial.uses}</dd>
        </dl>
        {vial.outlook ? (
          <p className={cn("mt-2 text-[14px] leading-5", low ? "font-semibold text-low" : "text-ink-2")} data-testid="vial-outlook">
            {vial.outlook}
          </p>
        ) : null}
        <p className="mt-2 text-[13px] leading-[18px] text-ink-3">{vial.mixLine}</p>
      </section>

      {vial.open ? <CorrectRemaining vial={vial} /> : null}
      {vial.open ? <VialDetails key={`${vial.label}/${vial.mixtureId}`} vial={vial} view={view} /> : null}

      <section aria-label={`History of ${vialName(vial.label, true)}`} className="px-2">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-2">History</h3>
        {vial.history.length ? (
          <ol className="divide-y divide-line">
            {vial.history.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2.5 text-[14px]" data-testid="vial-history-row" data-kind={entry.kind} data-discrepancy={entry.discrepancy}>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[13px]">{entry.when || "Dose not readable"}</span>
                  <span className="block text-[13px] text-ink-3">
                    {entry.cycleName ? `${entry.cycleName} · ` : ""}
                    {entry.after}
                    {entry.discrepancy ? " · past the vial's contents" : ""}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{entry.change}</span>
                {entry.href ? (
                  <Link href={entry.href} className="shrink-0 text-[14px] font-semibold text-signal-ink">
                    View dose
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] text-ink-3">Nothing deducted yet.</p>
        )}
      </section>
    </SheetContent>
  );
}

/** "Correct remaining": what's actually left, in mg or mcg; sent with the estimate shown. */
function CorrectRemaining({ vial }: { vial: VialCard }) {
  const correct = useSheetAction(correctVialAction);
  const request = useRequestKey();
  const seen = vial.remainingMg.startsWith("-") ? "0" : vial.remainingMg;
  const [unit, setUnit] = useState<MassUnit>(massUnit(seen) === "mcg" ? "mcg" : "mg");
  const [value, setValue] = useState("");
  const submit = () => {
    const form = { id: vial.id, seenRemainingMg: vial.remainingMg, remainingMg: mgFromUnit(value.trim().replace(",", "."), unit), label: vial.label };
    correct.run({ ...form, requestKey: request.keyFor(form) }, () => {
      request.done();
      setValue("");
    });
  };
  return (
    <section aria-labelledby={`correct-${vial.id}`} className="flex flex-col gap-2 px-2">
      <h3 id={`correct-${vial.id}`} className="text-[13px] font-semibold text-ink-2">
        Correct remaining
      </h3>
      <p className="text-[13px] leading-[18px] text-ink-3">If you measured what&apos;s left, enter it. It&apos;s kept in the vial&apos;s history.</p>
      <div className="flex items-stretch gap-2">
        <Field label={<span className="sr-only">Remaining</span>} className="min-w-0 flex-1 gap-0" error={null}>
          <NumberInput
            value={value}
            placeholder={inMassUnit(seen, unit)}
            onChange={(e) => {
              correct.setError(null);
              setValue(e.target.value);
            }}
            aria-label={`Remaining in ${unit}`}
            unit={
              <Segmented<MassUnit>
                size="mini"
                mono
                value={unit}
                onValueChange={setUnit}
                options={[
                  { value: "mcg", label: "mcg" },
                  { value: "mg", label: "mg" },
                ]}
                aria-label="Unit"
              />
            }
          />
        </Field>
        <Button variant="ink" size="lg" className="h-14" saving={correct.pending} disabled={!value.trim()} onClick={submit}>
          Save
        </Button>
      </div>
      <InlineError>{correct.error}</InlineError>
    </section>
  );
}

/** A vial's label and saved mixture (same peptide and strength), or "Not mixed yet". */
function VialDetails({ vial, view }: { vial: VialCard; view: SuppliesView }) {
  const save = useSheetAction(saveVialAction);
  const [label, setLabel] = useState(vial.label);
  const [mixtureId, setMixtureId] = useState(vial.mixtureId && view.mixtures.some((m) => m.id === vial.mixtureId) ? vial.mixtureId : NOT_MIXED);
  const options = view.mixtures.filter((m) => m.peptideId === vial.peptideId && m.strengthMg === vial.strengthMg);
  const changed = label !== vial.label || (mixtureId || null) !== (vial.mixtureId && view.mixtures.some((m) => m.id === vial.mixtureId) ? vial.mixtureId : null);
  return (
    <section aria-labelledby={`details-${vial.id}`} className="flex flex-col gap-3 px-2">
      <h3 id={`details-${vial.id}`} className="text-[13px] font-semibold text-ink-2">
        Details
      </h3>
      <Field label="Your label">
        <TextInput compact value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
      </Field>
      <Select label="Saved mixture" value={mixtureId} onChange={setMixtureId}>
        <option value={NOT_MIXED}>Not mixed yet</option>
        {options.map((m) => (
          <option key={m.id} value={m.id} disabled={m.openVial !== null && m.id !== vial.mixtureId}>
            {optionLabel(m)}
          </option>
        ))}
      </Select>
      <p className="text-[13px] text-ink-3">
        {vial.peptideName} · {vial.strengthMg} mg vial. The peptide and strength stay; a different vial is a new vial.
      </p>
      <InlineError>{save.error}</InlineError>
      {changed ? (
        <Button
          variant="outline"
          size="md"
          className="self-start"
          saving={save.pending}
          onClick={() => save.run({ id: vial.id, label, mixtureId: mixtureId || null, peptideId: vial.peptideId, strengthMg: vial.strengthMg })}
        >
          Save details
        </Button>
      ) : null}
    </section>
  );
}
