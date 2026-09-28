"use client";

import Link from "@/components/alpha/link";
import { ChevronRight, Info, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/alpha/button";
import { ChipGroup } from "@/components/alpha/chip";
import { Field, NumberInput, TextArea, TextInput } from "@/components/alpha/field";
import { SyringeRuler } from "@/components/alpha/gauges";
import { Segmented } from "@/components/alpha/segmented";
import { Sheet, SheetClose, SheetContent } from "@/components/alpha/sheet";
import { SYRINGE_CAPACITIES, SYRINGE_LABEL, type SyringeCapacity } from "@/lib/calculator/calculator";
import { Exact, formatRatio, parseDecimal } from "@/lib/calculator/decimal";
import { clock12, inMassUnit, massLabel, massUnit, mgFromUnit, wallWhen, weekdayOf } from "@/lib/alpha/format";
import {
  confirmFormError,
  daysBetween,
  drawDisplay,
  effectText,
  isWall,
  lateNote,
  NO_MIXTURE_NOTE,
  sheetUnitsLabel,
  SKIPPED_NOTE,
  VIAL_NOTE,
  type Wall,
  wallOf,
} from "@/lib/doses/rules";
import { ROTATION } from "@/lib/doses/sites";
import { type DoseDetail, setupForActual, type TodayView, vialForActual } from "@/lib/doses/today";
import { resolveLocal } from "@/lib/schedule/zone";
import type { SupplementDetail } from "@/lib/supplements/view";
import { takenTimeError } from "@/lib/supplements/rules";
import { resolveSyringe } from "@/lib/preferences/rules";
import { cn } from "@/lib/utils";
import { vialName } from "@/lib/supplies/name";

/** What the sheet submits (the server action adds nothing the screen didn't show). */
export type SheetSubmission = {
  amount: string;
  /** null: now, on the server's clock. */
  actual: Wall | null;
  site: string;
  notes: string;
  /** The saved-mixture version whose units were shown for that time (null: none). */
  seenMixtureVersion: string | null;
};

/** The wall-clock time now in `timeZone`, refreshed every 20 seconds while mounted. */
export function useWallNow(timeZone: string): Wall {
  const [now, setNow] = useState(() => wallOf(new Date(), timeZone));
  useEffect(() => {
    const timer = setInterval(() => setNow(wallOf(new Date(), timeZone)), 20_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  return now;
}

/** The instant of a wall-clock time in the dose's zone, as the server action resolves it. */
const instantOf = (wall: Wall, timeZone: string) => resolveLocal(wall.slice(0, 10), wall.slice(11, 16), timeZone).instant.toString();

/** The sheet's context line: when the dose is (or was) planned, in its state's tone. */
function contextOf(detail: DoseDetail, now: Wall): { text: string; tone: "default" | "signal" | "missed" } {
  const time = clock12(detail.planned.slice(11, 16));
  const day = weekdayOf(detail.planned);
  switch (detail.state) {
    case "open":
      return { text: `Not logged · ${day} ${time}`, tone: "missed" };
    case "due":
      return detail.planned <= now ? { text: `Due ${time} · ${day}`, tone: "signal" } : { text: `Later today · ${time}`, tone: "default" };
    case "taken":
      return { text: `Taken · planned ${day} ${time}`, tone: "default" };
    case "skipped":
      return { text: `Skipped · planned ${day} ${time}`, tone: "default" };
    default:
      return { text: `Planned ${day} ${time}`, tone: "default" };
  }
}

// ── Time taken (R2 / R2b; also the supplement sheet) ─────────────────────────

type TimeState = { mode: "now" | "earlier"; date: string; time: string };

/** The chosen actual time: null for now, else the typed wall-clock time (possibly incomplete). */
const actualOf = (state: TimeState): Wall | null => (state.mode === "now" ? null : `${state.date}T${state.time}`);

function TimeTaken({
  value,
  onChange,
  now,
  planned,
  autoFocus,
}: {
  value: TimeState;
  onChange: (next: TimeState) => void;
  now: Wall;
  planned: Wall;
  autoFocus?: boolean;
}) {
  return (
    <section aria-labelledby="time-taken" className="flex flex-col gap-2.5 px-2">
      <h3 id="time-taken" className="text-[13px] font-semibold text-ink-2">
        Time taken
      </h3>
      <Segmented
        aria-labelledby="time-taken"
        value={value.mode}
        onValueChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: "now", label: `Now · ${clock12(now.slice(11, 16))}` },
          { value: "earlier", label: "Earlier…" },
        ]}
      />
      {value.mode === "earlier" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <TextInput type="date" mono value={value.date} max={now.slice(0, 10)} onChange={(e) => onChange({ ...value, date: e.target.value })} />
            </Field>
            <Field label="Time">
              <TextInput type="time" mono value={value.time} autoFocus={autoFocus} onChange={(e) => onChange({ ...value, time: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-between gap-3 font-mono text-[12px] text-ink-3">
            <span>Planned {wallWhen(planned, now.slice(0, 10))}</span>
            <span>Must be before now</span>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ── R2 Log a dose / R2b Log a late dose ──────────────────────────────────────

type LogSheetProps = {
  detail: DoseDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: TodayView["sites"];
  /** Which request is in flight. */
  pending: "confirm" | "skip" | null;
  /** Set by the page after a refused save (e.g. the dose changed since it was shown). */
  error: string | null;
  notice: string | null;
  onSubmit: (submission: SheetSubmission) => void;
  onSkip: () => void;
  /** R8's default syringe, used when no saved mixture names one. */
  defaultSyringe?: SyringeCapacity;
};

/**
 * R2 (a bottom sheet on the phone, a drawer on a laptop): the draw, the
 * amount, when it was taken (now, or earlier: never later), the injection
 * site in rotation and a note; Skip or Taken. From an overdue row it is R2b:
 * Earlier is preselected at the planned time, and Skip reads "Mark skipped".
 * A dose already recorded, or skipped, shows that instead.
 */
export function LogSheet(props: LogSheetProps) {
  const { detail, open, onOpenChange } = props;
  return (
    <Sheet open={open && detail !== null} onOpenChange={onOpenChange}>
      {detail ? (
        <LogBody
          key={`${detail.key}/${detail.scheduledAt}/${detail.doseMg}/${detail.mixtureVersionId}/${detail.state}`}
          {...props}
          detail={detail}
        />
      ) : null}
    </Sheet>
  );
}

function LogBody({ detail, sites, pending, error: refused, notice, onSubmit, onSkip, defaultSyringe = 100 }: LogSheetProps & { detail: DoseDetail }) {
  const now = useWallNow(detail.timeZone);
  const context = contextOf(detail, now);

  if (detail.recorded) {
    const { recorded } = detail;
    return (
      <SheetContent
        title={detail.peptideName}
        context={context.text}
        contextTone={context.tone}
        size="auto"
        footer={
          <SheetClose render={<Button variant="outline" size="lg" />} className="flex-1">
            Close
          </SheetClose>
        }
      >
        <p className="px-2 text-[15px] leading-[22px] text-ink-2">
          Logged as taken at <b className="text-ink">{recorded.actual}</b> (entered {recorded.entered}). Logging it again never creates a
          duplicate.
        </p>
        <dl className="divide-y divide-line rounded-group border border-line bg-surface" data-testid="dose-recorded">
          <RecordedRow term="Amount taken">
            {recorded.amount}
            {recorded.planned ? <span className="text-ink-3"> {recorded.planned}</span> : null}
          </RecordedRow>
          <RecordedRow term="Injection site">{recorded.site || "—"}</RecordedRow>
          <RecordedRow term="Note">{recorded.notes || "—"}</RecordedRow>
        </dl>
      </SheetContent>
    );
  }

  if (detail.state === "skipped") {
    return (
      <SheetContent
        title={detail.peptideName}
        context={context.text}
        contextTone={context.tone}
        size="auto"
        footer={
          <SheetClose render={<Button variant="outline" size="lg" />} className="flex-1">
            Close
          </SheetClose>
        }
      >
        <p className="px-2 text-[15px] leading-[22px] text-ink-2" data-testid="dose-skipped">
          {SKIPPED_NOTE}
          {detail.skipped ? ` Entered ${detail.skipped.entered}.` : ""}
        </p>
      </SheetContent>
    );
  }

  return <LogForm detail={detail} now={now} context={context} sites={sites} pending={pending} refused={refused} notice={notice} onSubmit={onSubmit} onSkip={onSkip} defaultSyringe={defaultSyringe} />;
}

function RecordedRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-[13px] font-semibold text-ink-2">{term}</dt>
      <dd className="min-w-0 text-right text-[15px] break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function LogForm({
  detail,
  now,
  context,
  sites,
  pending,
  refused,
  notice,
  onSubmit,
  onSkip,
  defaultSyringe,
}: {
  detail: DoseDetail;
  now: Wall;
  context: { text: string; tone: "default" | "signal" | "missed" };
  sites: TodayView["sites"];
  pending: LogSheetProps["pending"];
  refused: string | null;
  notice: string | null;
  onSubmit: (submission: SheetSubmission) => void;
  onSkip: () => void;
  defaultSyringe: SyringeCapacity;
}) {
  const late = detail.state === "open";
  // The amount is entered in the planned dose's unit (mcg under 1 mg) and
  // kept as typed; what is calculated with and sent is always mg, exact.
  const unit = massUnit(detail.doseMg);
  const [amountText, setAmountValue] = useState(() => inMassUnit(detail.doseMg, unit));
  const amount = mgFromUnit(amountText, unit);
  const [editAmount, setEditAmount] = useState(false);
  const [when, setWhenValue] = useState<TimeState>(() => ({
    mode: late ? "earlier" : "now",
    date: detail.planned.slice(0, 10),
    time: detail.planned.slice(11, 16),
  }));
  const [site, setSiteValue] = useState<string>(sites.suggested);
  const [siteOpen, setSiteOpen] = useState(!late);
  const [notes, setNotesValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<SyringeCapacity | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // A check's message goes once the entry changes; the next submit re-checks.
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setError(null);
      set(value);
    };
  const [setAmount, setWhen, setSite, setNotes] = [edited(setAmountValue), edited(setWhenValue), edited(setSiteValue), edited(setNotesValue)];

  const actual = actualOf(when);
  const time = actual ?? now;
  // The setup in effect at the actual time chosen (now: the current one), whose
  // units are shown, whose version is sent back (confirm_dose checks it), and
  // whose mixture's tracked vial is deducted from.
  const valid = actual === null || isWall(actual);
  const at = actual !== null && isWall(actual) ? instantOf(actual, detail.timeZone) : null;
  const chosen = valid ? setupForActual(detail, at) : { setup: null, versionId: null, vialLabel: null };
  const vial = valid ? vialForActual(detail, at) : null;
  const { setup } = chosen;
  const shownCapacity = capacity ?? resolveSyringe(setup?.syringe, defaultSyringe);
  const draw = drawDisplay(setup, amount);
  const amountValue = parseDecimal(amount);
  const amountLabel = amountText.trim() === "" ? "—" : amountValue ? massLabel(amountValue) : `${amountText} ${unit}`;
  const plannedValue = parseDecimal(detail.doseMg);
  const differs = !amountValue || !plannedValue || !amountValue.equals(plannedValue);
  const daysLate = isWall(time) ? daysBetween(time.slice(0, 10), now.slice(0, 10)) : 0;
  const shown = error ?? refused;

  const submit = () => {
    const submission: SheetSubmission = { amount, actual, site, notes, seenMixtureVersion: chosen.versionId };
    const problem = confirmFormError(submission, now);
    setError(problem);
    if (!problem) onSubmit(submission);
  };

  // Vial after: the estimate now less this amount; low when under the next planned dose.
  let vialAfter: { text: string; sub: string; low: boolean } | null = null;
  if (vial) {
    const after = amountValue ? new Exact(vial.remainingMg).minus(amountValue) : null;
    const low = after !== null && (after.isNegative() || (detail.vialNextMg !== null && after.lessThan(detail.vialNextMg)));
    vialAfter = { text: after ? massLabel(after) : "—", sub: `of ${massLabel(vial.strengthMg)} · ${vialName(vial.label, true)}`, low };
  }
  const primaryLabel = late && actual !== null && isWall(actual) ? `Log at ${clock12(actual.slice(11, 16))}` : `Taken · ${amountLabel}`;

  return (
    <SheetContent
      title={detail.peptideName}
      context={context.text}
      contextTone={context.tone}
      footer={
        <>
          <Button variant="outline" size="lg" className={late ? "w-32" : "w-[104px]"} onClick={onSkip} saving={pending === "skip"} disabled={pending !== null}>
            {late ? "Mark skipped" : "Skip"}
          </Button>
          <Button size="lg" onClick={submit} saving={pending === "confirm"} disabled={pending !== null}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      {notice ? (
        <p className="mx-2 rounded-[14px] bg-low-tint px-3.5 py-2.5 text-[14px] font-medium text-ink" role="status">
          {notice}
        </p>
      ) : null}

      {/* Draw card */}
      <section aria-label="Draw" className="rounded-[24px] bg-surface px-[18px] pt-4 pb-3 laptop:border laptop:border-line">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink-2">Draw</span>
          {setup ? (
            <Segmented
              aria-label="Syringe"
              size="mini"
              mono
              value={String(shownCapacity) as `${SyringeCapacity}`}
              onValueChange={(next) => setCapacity(Number(next) as SyringeCapacity)}
              options={SYRINGE_CAPACITIES.map((c) => ({ value: String(c) as `${SyringeCapacity}`, label: String(c) }))}
            />
          ) : null}
        </div>
        {draw.kind === "units" ? (
          <>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[80px] leading-[0.8] font-semibold tracking-[-0.055em]" data-testid="sheet-reading">
                  {draw.units}
                </span>
                <span className="font-mono text-[19px] text-ink-3">units</span>
              </div>
              <div className="text-right">
                <div className="font-mono text-[17px] font-semibold">{draw.volume} mL</div>
                <div className="mt-0.5 text-[13px] text-ink-3">of {SYRINGE_LABEL[shownCapacity]}</div>
              </div>
            </div>
            <SyringeRuler
              className="mt-4"
              units={draw.units}
              capacity={shownCapacity}
              lineSpacing={setup && shownCapacity === setup.syringe ? setup.lineSpacing : undefined}
            />
          </>
        ) : (
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[56px] leading-none font-semibold tracking-[-0.05em]">{amountText || "—"}</span>
              <span className="font-mono text-[19px] text-ink-3">{unit}</span>
            </div>
            <p className="mt-2 flex gap-1.5 text-[13px] text-ink-2">
              <Info className="mt-0.5 size-[15px] shrink-0" aria-hidden />
              <span>
                {draw.kind === "error" ? `Units can't be calculated with your saved mixture: ${draw.message}` : NO_MIXTURE_NOTE}{" "}
                <Link href={detail.calculatorHref} className="font-semibold text-signal-ink underline-offset-2 hover:underline">
                  {draw.kind === "error" ? "Check it in the calculator" : "Set one up in the calculator"}
                </Link>
              </span>
            </p>
          </div>
        )}
        <p className="mt-1 font-mono text-[12px] text-ink-3" data-testid="sheet-units">
          {sheetUnitsLabel(setup, amount)}
        </p>
      </section>

      {/* Strip: dose · mix · vial after */}
      <div className="grid grid-cols-3 divide-x divide-line rounded-[18px] border border-line bg-surface">
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[12px] font-semibold text-ink-3">Dose</div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="truncate font-mono text-[15px] font-semibold">{amountLabel}</span>
            <button
              type="button"
              aria-label="Change the amount taken"
              aria-expanded={editAmount}
              onClick={() => {
                setEditAmount(true);
                setTimeout(() => amountRef.current?.focus(), 0);
              }}
              className="-m-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-2"
            >
              <Pencil className="size-[15px]" aria-hidden />
            </button>
          </div>
          {differs ? <div className="truncate text-[12px] text-ink-3">planned {massLabel(detail.doseMg)}</div> : null}
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <div className="text-[12px] font-semibold text-ink-3">Mix</div>
          {setup ? (
            <>
              <div className="mt-0.5 truncate font-mono text-[15px] font-semibold">{formatRatio(setup.vialMg, setup.liquidMl)} mg/mL</div>
              <div className="truncate text-[12px] text-ink-3">
                {setup.vialMg} mg + {setup.liquidMl} mL
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-[13px] text-ink-3">No mixture</div>
          )}
        </div>
        <div className={cn("min-w-0 rounded-r-[17px] px-3 py-2.5", vialAfter?.low && "bg-low-tint")} data-testid="sheet-vial-after" data-low={vialAfter?.low || undefined}>
          <div className={cn("text-[12px] font-semibold", vialAfter?.low ? "text-low" : "text-ink-3")}>{vialAfter?.low ? "Vial after · low" : "Vial after"}</div>
          {vialAfter ? (
            <>
              <div className="mt-0.5 truncate font-mono text-[15px] font-semibold">{vialAfter.text}</div>
              <div className="truncate text-[12px] text-ink-3">{vialAfter.sub}</div>
            </>
          ) : (
            <div className="mt-0.5 text-[13px] text-ink-3">Not tracked</div>
          )}
        </div>
      </div>

      {editAmount ? (
        <Field label={`Amount taken (${unit})`} description={`Planned ${massLabel(detail.doseMg)}`} className="px-2">
          <NumberInput ref={amountRef} unit={unit} value={amountText} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      ) : null}

      <TimeTaken value={when} onChange={setWhen} now={now} planned={detail.planned} autoFocus={late} />
      <div className="flex flex-col gap-1 px-2 text-[13px] leading-[18px] text-ink-3">
        {daysLate > 0 ? <p>{lateNote(daysLate)}</p> : null}
        <p data-testid="sheet-effect">{effectText(detail.effect, detail.peptideName, isWall(time) ? time : now, now)}</p>
        {chosen.vialLabel ? <p data-testid="sheet-vial">{VIAL_NOTE(chosen.vialLabel)}</p> : null}
      </div>

      {/* Injection site */}
      <section aria-labelledby="dose-site" className="flex flex-col gap-2.5 px-2">
        {siteOpen ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <h3 id="dose-site" className="text-[13px] font-semibold text-ink-2">
                Injection site
              </h3>
              {sites.last ? <span className="font-mono text-[12px] text-ink-3">{sites.last.note}</span> : null}
            </div>
            <ChipGroup
              aria-labelledby="dose-site"
              className="grid grid-cols-4 gap-1.5 [&>*]:min-w-0 [&>*]:justify-center [&>*]:px-0.5 [&>*]:text-[14px] [&>*]:tracking-[-0.01em] [&>*]:whitespace-nowrap"
              value={site ? [site] : []}
              onValueChange={(next) => setSite(next[0] ?? "")}
              options={ROTATION.map((value) => ({ value, label: value, lastUsed: sites.last?.site === value }))}
            />
          </>
        ) : (
          <button
            type="button"
            id="dose-site"
            onClick={() => setSiteOpen(true)}
            className="flex h-12 cursor-pointer items-center justify-between rounded-[14px] border border-line bg-surface px-3.5 text-[15px]"
          >
            <span>
              <span className="text-ink-2">Injection site · </span>
              <span className="font-semibold">{site || "None"}</span>
            </span>
            <ChevronRight className="size-[18px] text-ink-3" aria-hidden />
          </button>
        )}
      </section>

      <Field label="Note" optional className="px-2">
        <TextArea rows={2} className="min-h-12" placeholder="Add a note" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {shown ? (
        <p role="alert" className="mx-2 flex items-start gap-1.5 text-[14px] font-medium text-missed">
          <Info className="mt-0.5 size-[15px] shrink-0" aria-hidden />
          {shown}
        </p>
      ) : null}
    </SheetContent>
  );
}

// ── A supplement's Taken at another time ─────────────────────────────────────

/** Today's supplement sheet: when it was actually taken (now, or earlier; never later), then Taken. */
export function SupplementSheet({
  detail,
  onClose,
  pending,
  onSubmit,
}: {
  detail: SupplementDetail | null;
  onClose: () => void;
  pending: boolean;
  onSubmit: (detail: SupplementDetail, actual: Wall | null, onError: (message: string) => void) => void;
}) {
  return (
    <Sheet open={detail !== null} onOpenChange={(open) => (open ? null : onClose())}>
      {detail ? <SupplementBody key={`${detail.key}/${detail.scheduledAt}/${detail.amount}/${detail.unit}`} detail={detail} pending={pending} onSubmit={onSubmit} /> : null}
    </Sheet>
  );
}

function SupplementBody({
  detail,
  pending,
  onSubmit,
}: {
  detail: SupplementDetail;
  pending: boolean;
  onSubmit: (detail: SupplementDetail, actual: Wall | null, onError: (message: string) => void) => void;
}) {
  const now = useWallNow(detail.timeZone);
  const [when, setWhenValue] = useState<TimeState>({ mode: "now", date: detail.planned.slice(0, 10), time: detail.planned.slice(11, 16) });
  const [error, setError] = useState<string | null>(null);
  const actual = actualOf(when);
  const submit = () => {
    const problem = takenTimeError(actual, now);
    setError(problem);
    if (!problem) onSubmit(detail, actual, setError);
  };
  return (
    <SheetContent
      title={detail.name}
      context={`Supplement · planned ${clock12(detail.planned.slice(11, 16))}`}
      size="auto"
      footer={
        <Button size="lg" onClick={submit} saving={pending}>
          {`Taken · ${detail.amount} ${detail.unit}`}
        </Button>
      }
    >
      <TimeTaken
        value={when}
        onChange={(next) => {
          setError(null);
          setWhenValue(next);
        }}
        now={now}
        planned={detail.planned}
      />
      {error ? (
        <p role="alert" className="mx-2 flex items-start gap-1.5 text-[14px] font-medium text-missed">
          <Info className="mt-0.5 size-[15px] shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </SheetContent>
  );
}
