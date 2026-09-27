"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { confirmDoseAction, type ConfirmActionResult } from "@/app/(private)/app/today/actions";
import { SAVE_FAILED_MESSAGE, useToast } from "@/components/app-shell/toast";
import { AppBadge } from "@/components/push/app-badge";
import { discrepancyToast, ENDED_NOTE, NO_MIXTURE_NOTE, takenToast } from "@/lib/doses/rules";
import type { DoseDetail, TodayHero, TodayView } from "@/lib/doses/today";
import { ConfirmSheet, type SheetSubmission, takenWhen } from "./confirm-sheet";

/**
 * R1 Today: the next due dose with its mg and syringe units and a one-tap
 * Taken, today's other doses, unconfirmed past doses (Confirm opens R5), and
 * the next dose of each plan. `?dose=<key>` (a reminder tap) opens that dose's
 * sheet with its current details.
 */
export function TodayScreen({ view }: { view: TodayView }) {
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
      } catch {
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
          <p>Start from a supplied template or build a custom cycle. Nothing is due until a plan exists.</p>
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
        <Hero hero={view.hero} busy={busy(view.hero.key)} disabled={pending} onTaken={() => quick(view.hero!.key)} onMore={() => openSheet(view.hero!.key)} />
      ) : null}

      {view.nothingDue ? (
        <section className="app-today-quiet" data-testid="today-quiet">
          <div className="app-today-quiet-title">{view.nothingDue.title}</div>
          <div className="app-today-quiet-body">{view.nothingDue.body}</div>
        </section>
      ) : null}

      {view.hasCycles ? (
        <div className="app-today-list">
          {view.rows.map((row) => (
            <div key={`${row.kind}/${row.key}`} className="app-today-row" data-kind={row.kind} data-testid="today-row">
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
                <button type="button" className="app-today-row-action" disabled={pending} onClick={() => quick(row.key)}>
                  {busy(row.key) ? "Saving…" : "Taken"}
                </button>
              ) : row.action === "Confirm" || row.action === "Details" ? (
                <button type="button" className="app-today-row-action" disabled={pending} onClick={() => openSheet(row.key)}>
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
          ))}
          <div className="app-today-list-end" />
          <p className="app-today-footnote">{ENDED_NOTE}</p>
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
    </>
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
