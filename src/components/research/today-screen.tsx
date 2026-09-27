"use client";

import Link from "next/link";
import { unstable_rethrow, usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { confirmDoseAction, type ConfirmActionResult } from "@/app/(private)/app/today/actions";
import { SAVE_FAILED_MESSAGE, useToast } from "@/components/app-shell/toast";
import { AppBadge } from "@/components/push/app-badge";
import { discrepancyToast, ENDED_NOTE, NO_MIXTURE_NOTE, takenToast } from "@/lib/doses/rules";
import type { DoseDetail, TodayHero, TodayRow, TodayView } from "@/lib/doses/today";
import { mergeTodayRows, type SupplementDetail, type SupplementRow, type SupplementToday, todayNotes } from "@/lib/supplements/view";
import { ConfirmSheet, type SheetSubmission, takenWhen } from "./confirm-sheet";
import { SupplementTimeSheet, useTakeSupplement } from "./supplement-taken";

/**
 * R1 Today: the next due dose with its mg and syringe units and a one-tap
 * Taken, today's other doses, unconfirmed past doses (Confirm opens R5), and
 * the next dose of each plan, with today's supplement routines after today's
 * doses (R10; their own one-tap Taken, or "Other time"). `?dose=<key>` (a
 * reminder tap) opens that dose's sheet with its current details.
 */
export function TodayScreen({ view, supplements }: { view: TodayView; supplements: SupplementToday }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [sheetKey, setSheetKey] = useState<string | null>(view.requested && !view.requested.notice ? view.requested.key : null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One request key per dose for this page's life: a retry or a double tap
  // sends the same key, so the server records one dose and returns it again.
  const requestKeys = useRef(new Map<string, string>());
  const requestKeyFor = (key: string) => {
    let value = requestKeys.current.get(key);
    if (!value) {
      value = crypto.randomUUID();
      requestKeys.current.set(key, value);
    }
    return value;
  };

  const closeSheet = () => {
    setSheetKey(null);
    setSheetError(null);
    setSheetNotice(null);
    // Drop ?dose= once handled, so a later refresh doesn't reopen it.
    if (view.requested) router.replace(pathname, { scroll: false });
  };

  const confirm = (detail: DoseDetail, submission: SheetSubmission, fromSheet: boolean) => {
    if (pending) return;
    setPendingKey(detail.key);
    setSheetError(null);
    startTransition(async () => {
      let result: ConfirmActionResult;
      try {
        result = await confirmDoseAction({
          requestKey: requestKeyFor(detail.key),
          key: detail.key,
          seenScheduledAt: detail.scheduledAt,
          seenDoseMg: detail.doseMg,
          timeZone: detail.timeZone,
          ...submission,
        });
      } catch (error) {
        // A redirect (the session ended: sign in again) goes to Next.js, not to the toast.
        unstable_rethrow(error);
        toast(SAVE_FAILED_MESSAGE, "error");
        setPendingKey(null);
        return;
      }
      setPendingKey(null);
      if (result.outcome === "recorded" && result.actualAt) {
        const when = takenWhen(result.actualAt, detail.timeZone);
        if (result.discrepancyVial) toast(discrepancyToast(detail.peptideName, when, result.discrepancyVial), "warn");
        else toast(takenToast(detail.peptideName, when), "info");
        if (fromSheet) closeSheet();
        return;
      }
      if (result.outcome === "changed" || result.outcome === "already") {
        // The page refreshed: the sheet shows the dose as it is now.
        setSheetKey(detail.key);
        setSheetNotice(result.outcome === "changed" ? (result.error ?? null) : null);
        return;
      }
      if (result.outcome === "gone") {
        closeSheet();
        if (result.toast) toast(result.toast, result.tone ?? "error");
        return;
      }
      if (result.error) {
        if (fromSheet) setSheetError(result.error);
        else toast(result.error, "error");
      }
      if (result.toast) toast(result.toast, result.tone ?? "error");
    });
  };

  const quick = (key: string) => {
    const detail = view.doses[key];
    // Now, the planned amount, and the setup whose units the screen shows.
    if (detail) confirm(detail, { amount: detail.doseMg, actual: null, site: "", notes: "", seenMixtureVersion: detail.mixtureVersionId }, false);
  };
  const openSheet = (key: string) => {
    setSheetError(null);
    setSheetNotice(null);
    setSheetKey(key);
  };
  const sheetDetail = sheetKey ? (view.doses[sheetKey] ?? null) : null;
  const busy = (key: string) => pending && pendingKey === key;

  const supplement = useTakeSupplement();
  const [supplementSheet, setSupplementSheet] = useState<SupplementDetail | null>(null);
  const saving = pending || supplement.pending;
  const items = mergeTodayRows(view.rows, supplements.rows);
  const notes = todayNotes(view, supplements);

  return (
    <>
      <AppBadge count={view.badge} />
      <div className="app-today-head">
        <div>
          <div className="app-today-date">{view.dateLabel}</div>
          <h1 className="app-h1 app-today-title">Today</h1>
        </div>
        <span className="app-today-zone">{view.timeZone}</span>
      </div>

      {view.requested?.notice ? (
        <p role="status" className="app-today-notice">
          {view.requested.notice}
        </p>
      ) : null}

      {!view.hasCycles ? (
        <div className="app-today-empty">
          <h2>No cycles yet</h2>
          <p data-testid="today-empty-body">{notes.noCyclesBody}</p>
          <div className="app-today-empty-actions">
            <Link href="/app/library" className="app-btn app-btn--primary app-today-empty-btn">
              Browse templates
            </Link>
            <Link href="/app/cycles/new" className="app-btn app-btn--secondary app-today-empty-btn">
              Custom cycle
            </Link>
          </div>
        </div>
      ) : null}

      {view.hero ? (
        <Hero hero={view.hero} busy={busy(view.hero.key)} disabled={saving} onTaken={() => quick(view.hero!.key)} onMore={() => openSheet(view.hero!.key)} />
      ) : null}

      {notes.nothingDue ? (
        <section className="app-today-quiet" data-testid="today-quiet">
          <div className="app-today-quiet-title">{notes.nothingDue.title}</div>
          <div className="app-today-quiet-body">{notes.nothingDue.body}</div>
        </section>
      ) : null}

      {view.hasCycles || items.length > 0 ? (
        <div className="app-today-list">
          {items.map((item) =>
            item.type === "dose" ? (
              <DoseRowView
                key={`${item.row.kind}/${item.row.key}`}
                row={item.row}
                disabled={saving}
                busy={busy(item.row.key)}
                onTaken={() => quick(item.row.key)}
                onOpen={() => openSheet(item.row.key)}
              />
            ) : (
              <SupplementRowView
                key={`supplement/${item.row.key}`}
                row={item.row}
                disabled={saving}
                busy={supplement.busy(item.row.key)}
                onTaken={(detail) => supplement.take(detail, null)}
                onOtherTime={setSupplementSheet}
              />
            ),
          )}
          <div className="app-today-list-end" />
          {view.hasCycles ? <p className="app-today-footnote">{ENDED_NOTE}</p> : null}
        </div>
      ) : null}

      <ConfirmSheet
        detail={sheetDetail}
        open={sheetKey !== null}
        onOpenChange={(next) => (next ? null : closeSheet())}
        pending={pending}
        error={sheetError}
        notice={sheetNotice}
        onSubmit={(submission) => sheetDetail && confirm(sheetDetail, submission, true)}
      />
      <SupplementTimeSheet
        detail={supplementSheet}
        onClose={() => setSupplementSheet(null)}
        pending={supplement.pending}
        onSubmit={(detail, actual, onError) => supplement.take(detail, actual, { onDone: () => setSupplementSheet(null), onError })}
      />
    </>
  );
}

type DoseRowProps = { row: TodayRow; disabled: boolean; busy: boolean; onTaken: () => void; onOpen: () => void };

function DoseRowView({ row, disabled, busy, onTaken, onOpen }: DoseRowProps) {
  return (
    <div className="app-today-row" data-kind={row.kind} data-testid="today-row">
      <div className="app-today-row-text">
        <div className="app-today-row-title">{row.title}</div>
        <div className="app-today-row-sub">{row.sub}</div>
        {row.stockNote ? (
          <div className="app-today-stock" data-testid="today-stock">
            {row.stockNote}
          </div>
        ) : null}
      </div>
      {row.action === "Taken" ? (
        <button type="button" className="app-today-row-action" disabled={disabled} onClick={onTaken}>
          {busy ? "Saving…" : "Taken"}
        </button>
      ) : row.action === "Confirm" || row.action === "Details" ? (
        <button type="button" className="app-today-row-action" disabled={disabled} onClick={onOpen}>
          {row.action}
        </button>
      ) : null}
      {row.status ? (
        <span className="app-today-row-status" data-status={row.status}>
          {row.status}
          {row.statusNote ? <span className="app-today-row-status-note"> {row.statusNote}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

type SupplementRowProps = {
  row: SupplementRow;
  disabled: boolean;
  busy: boolean;
  onTaken: (detail: SupplementDetail) => void;
  onOtherTime: (detail: SupplementDetail) => void;
};

/** A supplement routine's line (the prototype's): one-tap Taken (now), or "Other time" for when it was actually taken. */
function SupplementRowView({ row, disabled, busy, onTaken, onOtherTime }: SupplementRowProps) {
  const { detail } = row;
  return (
    <div className="app-today-row" data-kind="supplement" data-testid="today-supplement">
      <div className="app-today-row-text">
        <div className="app-today-row-title">{row.title}</div>
        <div className="app-today-row-sub">{row.sub}</div>
        {detail ? (
          <button type="button" className="app-today-row-more" disabled={disabled} onClick={() => onOtherTime(detail)}>
            Other time
          </button>
        ) : null}
      </div>
      {detail ? (
        <button type="button" className="app-today-row-action" disabled={disabled} onClick={() => onTaken(detail)}>
          {busy ? "Saving…" : "Taken"}
        </button>
      ) : (
        <span className="app-today-row-status" data-status={row.status} data-testid="supplement-status">
          {row.status}
        </span>
      )}
    </div>
  );
}

function Hero({ hero, busy, disabled, onTaken, onMore }: { hero: TodayHero; busy: boolean; disabled: boolean; onTaken: () => void; onMore: () => void }) {
  const { draw } = hero;
  return (
    <section aria-label="Next due" className="app-today-hero" data-testid="today-hero">
      <div className="app-today-hero-top">
        <span>
          {hero.dueWord} · {hero.time}
        </span>
        <span className="app-today-hero-cycle">{hero.cycleName}</span>
      </div>
      <div className="app-today-hero-name">{hero.peptideName}</div>
      {draw.kind === "units" ? (
        <>
          <div className="app-today-hero-amount">
            <span className="app-today-hero-units" data-testid="hero-units">
              {draw.units}
            </span>
            <span className="app-today-hero-unit-word">units</span>
          </div>
          <div className="app-today-hero-detail">
            {hero.doseMg} mg · {draw.volume} mL · from your {hero.mixtureLabel} mixture · {hero.syringeLabel} syringe
          </div>
          {draw.flag ? (
            <p role="alert" className="app-today-hero-flag">
              {draw.flag}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="app-today-hero-amount">
            <span className="app-today-hero-mg" data-testid="hero-mg">
              {hero.doseMg} mg
            </span>
          </div>
          <p className="app-today-hero-nomix">
            {draw.kind === "error" ? `Units can't be calculated with your saved mixture: ${draw.message}` : NO_MIXTURE_NOTE}{" "}
            <Link href={hero.calculatorHref}>{draw.kind === "error" ? "Check it in the calculator" : "Set one up in the calculator"}</Link> — you can
            still record Taken.
          </p>
        </>
      )}
      {hero.stockNote ? (
        <p className="app-today-stock" data-testid="today-stock">
          {hero.stockNote} · <Link href="/app/supplies">Personal supplies</Link>
        </p>
      ) : null}
      <button type="button" className="app-dose-taken" disabled={disabled} onClick={onTaken}>
        {busy ? "Saving…" : "Taken"}
      </button>
      <button type="button" className="app-today-hero-more" onClick={onMore}>
        Add time, site or notes
      </button>
    </section>
  );
}
