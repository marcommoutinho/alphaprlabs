"use client";

import Link from "@/components/alpha/link";
import { unstable_rethrow, usePathname, useRouter } from "next/navigation";
import { Check, Pill } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  confirmDoseAction,
  type ConfirmActionResult,
  skipDoseAction,
  type SkipActionResult,
  undoDoseAction,
} from "@/app/(private)/app/today/actions";
import { Button, buttonVariants } from "@/components/alpha/button";
import { SyringeRuler } from "@/components/alpha/gauges";
import { StatusRow } from "@/components/alpha/list";
import { NowActions, NowBlock, NowHeader, NowReading } from "@/components/alpha/now-block";
import { StateGlyph, type GlyphState } from "@/components/alpha/state-glyph";
import { lowCounter, useNavCount } from "@/components/alpha/shell/nav-counts";
import { useAlphaToast } from "@/components/alpha/toast";
import { SAVE_FAILED_MESSAGE } from "@/components/app-shell/toast";
import { AppBadge } from "@/components/push/app-badge";
import { clock12, massLabel, untilLabel, wallWhen } from "@/lib/alpha/format";
import { dayProgress, dayRail, type RailEntry } from "@/lib/doses/board";
import { ENDED_NOTE, loggedToast, NO_MIXTURE_NOTE, skippedToast, UNDO_FAILED, undoneToast, wallOf } from "@/lib/doses/rules";
import type { DoseDetail, TodayDose, TodayView } from "@/lib/doses/today";
import { type SupplementDetail, type SupplementRow, type SupplementToday, todayNotes } from "@/lib/supplements/view";
import type { LowVialRow } from "@/lib/supplies/view";
import { cn } from "@/lib/utils";
import { FEELING_WORDS } from "@/lib/progress/rules";
import { CheckInSheet, type CheckInContext } from "./check-in-sheet";
import { LogSheet, type SheetSubmission, SupplementSheet } from "./log-sheet";
import { useTakeSupplement } from "./supplement-taken";
import { rememberLoaded } from "./today-loaded";
import { vialName } from "@/lib/supplies/name";

/** Today's check-in, as R1's card and R6 need it. */
export type TodayCheckIn = CheckInContext & { done: boolean };

type Props = {
  view: TodayView;
  supplements: SupplementToday;
  lowVials: readonly LowVialRow[];
  checkIn: TodayCheckIn;
  /** The avatar's initials (it opens Me). */
  initials: string;
};

type Busy = { key: string; kind: "confirm" | "skip" } | null;

/** The time now, ticking every 30 s after hydration (the server's render time before, so both render alike). */
function useNowMs(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** One request key per entry for the page's life: a retry or a double tap sends the same key. */
function useRequestKeys() {
  const keys = useRef(new Map<string, string>());
  return {
    get(key: string) {
      let value = keys.current.get(key);
      if (!value) {
        value = crypto.randomUUID();
        keys.current.set(key, value);
      }
      return value;
    },
    drop(key: string) {
      keys.current.delete(key);
    },
  };
}

/**
 * R1 Today (design v3; D1 on a laptop): the header with the day's progress,
 * the Now block (the next dose due, with its syringe reading and a one-tap
 * Taken, then an Undo toast), overdue doses (Log opens R2b), the check-in
 * card (R6), the day rail of doses and supplements, each plan's next dose,
 * and low vials. `?dose=<key>` (a reminder tap) opens that dose's sheet with
 * its current details.
 */
export function TodayScreen({ view, supplements, lowVials, checkIn, initials }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useAlphaToast();
  const nowMs = useNowMs(view.renderedAt);
  const [sheetKey, setSheetKey] = useState<string | null>(view.requested && !view.requested.notice ? view.requested.key : null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [checkInFeeling, setCheckInFeeling] = useState<number | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [supplementSheet, setSupplementSheet] = useState<SupplementDetail | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [, startTransition] = useTransition();
  const confirmKeys = useRequestKeys();
  const skipKeys = useRequestKeys();

  useEffect(() => rememberLoaded(view.renderedAt, view.timeZone), [view.renderedAt, view.timeZone]);

  const supplement = useTakeSupplement((message, tone) => (tone === "error" ? toast.error({ message }) : toast.success({ message })));

  const closeSheet = () => {
    setSheetKey(null);
    setSheetError(null);
    setSheetNotice(null);
    // Drop ?dose= once handled, so a later refresh doesn't reopen it.
    if (view.requested) router.replace(pathname, { scroll: false });
  };
  const openSheet = (key: string) => {
    setSheetError(null);
    setSheetNotice(null);
    setSheetKey(key);
  };

  /** Undo a Taken or a skip just recorded (the toast's action): undo_dose, with its own request key. */
  const undo = (entryId: string, detail: DoseDetail) => {
    startTransition(async () => {
      let result;
      try {
        result = await undoDoseAction({ requestKey: crypto.randomUUID(), entryId });
      } catch (error) {
        unstable_rethrow(error);
        toast.error({ message: UNDO_FAILED });
        return;
      }
      if (result.outcome === "undone") {
        // The dose is open again: a new Taken or Skip is a new request.
        confirmKeys.drop(detail.key);
        skipKeys.drop(detail.key);
        toast.success({ message: undoneToast(detail.peptideName) });
      } else toast.error({ message: result.error ?? UNDO_FAILED });
    });
  };

  const confirm = (detail: DoseDetail, submission: SheetSubmission, fromSheet: boolean, retried = false) => {
    if (busy) return;
    setBusy({ key: detail.key, kind: "confirm" });
    setSheetError(null);
    startTransition(async () => {
      let result: ConfirmActionResult;
      try {
        result = await confirmDoseAction({
          requestKey: confirmKeys.get(detail.key),
          key: detail.key,
          seenScheduledAt: detail.scheduledAt,
          seenDoseMg: detail.doseMg,
          timeZone: detail.timeZone,
          ...submission,
        });
      } catch (error) {
        // A redirect (the session ended: sign in again) goes to Next.js, not to the toast.
        unstable_rethrow(error);
        toast.error({ message: SAVE_FAILED_MESSAGE });
        setBusy(null);
        return;
      }
      setBusy(null);
      if (result.outcome === "recorded" && result.actualAt && result.doseId) {
        const doseId = result.doseId;
        const at = clock12(wallOf(result.actualAt, detail.timeZone).slice(11, 16));
        const logged = loggedToast(detail.peptideName, massLabel(result.amountMg ?? submission.amount), at);
        const message = result.discrepancyVial
          ? `${logged}. ${vialName(result.discrepancyVial)}'s estimate is now below zero — check it in Personal supplies.`
          : logged;
        toast.success({ message, action: { label: "Undo", onAction: () => undo(doseId, detail) } });
        if (fromSheet) closeSheet();
        return;
      }
      if (result.outcome === "undone" && !retried) {
        // This request's entry was undone elsewhere: log it as a new request.
        confirmKeys.drop(detail.key);
        confirm(detail, submission, fromSheet, true);
        return;
      }
      if (result.outcome === "changed" || result.outcome === "already") {
        // The page refreshed: the sheet shows the dose as it is now.
        setSheetKey(detail.key);
        setSheetNotice(result.outcome === "changed" ? (result.error ?? null) : null);
        return;
      }
      if (result.outcome === "skipped") {
        setSheetKey(detail.key);
        if (result.error) toast.error({ message: result.error });
        return;
      }
      if (result.outcome === "gone") {
        closeSheet();
        if (result.toast) toast.error({ message: result.toast });
        return;
      }
      if (result.error) {
        if (fromSheet) setSheetError(result.error);
        else toast.error({ message: result.error });
      }
      if (result.toast) toast.error({ message: result.toast });
    });
  };

  const skip = (detail: DoseDetail, fromSheet: boolean) => {
    if (busy) return;
    setBusy({ key: detail.key, kind: "skip" });
    setSheetError(null);
    startTransition(async () => {
      let result: SkipActionResult;
      try {
        result = await skipDoseAction({
          requestKey: skipKeys.get(detail.key),
          key: detail.key,
          seenScheduledAt: detail.scheduledAt,
          seenDoseMg: detail.doseMg,
        });
      } catch (error) {
        unstable_rethrow(error);
        toast.error({ message: SAVE_FAILED_MESSAGE });
        setBusy(null);
        return;
      }
      setBusy(null);
      if (result.outcome === "skipped" && result.skipId) {
        const skipId = result.skipId;
        toast.success({
          message: skippedToast(detail.peptideName, clock12(detail.planned.slice(11, 16))),
          action: { label: "Undo", onAction: () => undo(skipId, detail) },
        });
        if (fromSheet) closeSheet();
        return;
      }
      if (result.outcome === "undone") {
        skipKeys.drop(detail.key);
        toast.error({ message: "That skip was undone. Try again." });
        return;
      }
      if (result.outcome === "already_skipped") {
        if (fromSheet) closeSheet();
        return;
      }
      if (result.outcome === "changed" || result.outcome === "taken") {
        setSheetKey(detail.key);
        setSheetNotice(result.error ?? null);
        return;
      }
      if (result.outcome === "gone") {
        closeSheet();
        if (result.toast) toast.error({ message: result.toast });
        return;
      }
      if (result.error) {
        if (fromSheet) setSheetError(result.error);
        else toast.error({ message: result.error });
      }
      if (result.toast) toast.error({ message: result.toast });
    });
  };

  /** One-tap Taken: the planned amount, now, the suggested site, the setup (and vial) in use. */
  const quick = (key: string) => {
    const detail = view.doses[key];
    if (detail)
      confirm(detail, { amount: detail.doseMg, actual: null, site: view.sites.suggested, notes: "", seenMixtureVersion: detail.mixtureVersionId }, false);
  };

  const nowItem = view.now ? (view.items.find((item) => item.key === view.now!.key) ?? null) : null;
  const canTakeNow = nowItem !== null && view.now!.mode !== "next";
  const sheetOpen = sheetKey !== null || checkInOpen || supplementSheet !== null;

  // D1: "Press T to log" (the Now block's Taken) on a laptop keyboard.
  const quickRef = useRef<() => void>(() => {});
  useEffect(() => {
    quickRef.current = () => {
      if (canTakeNow && !sheetOpen && !busy) quick(nowItem!.key);
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "t" && event.key !== "T") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      event.preventDefault();
      quickRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notes = todayNotes(view, supplements);
  const progress = dayProgress({ doses: view.items, supplements: supplements.rows, checkedIn: checkIn.done, today: view.today, now: new Date(nowMs) });
  const overdue = view.items.filter((item) => item.kind === "open");
  const rail = dayRail(view.items, supplements.rows);
  // D1: the sidebar's Today counter shows the overdue doses.
  useNavCount("today", overdue.length ? { text: String(overdue.length), tone: "missed" } : null);
  useNavCount("supplies", lowCounter(lowVials.length));
  const next = view.items.filter((item) => item.kind === "next");
  const sheetDetail = sheetKey ? (view.doses[sheetKey] ?? null) : null;
  const disabled = busy !== null || supplement.pending;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col pb-[calc(96px+env(safe-area-inset-bottom))] laptop:px-8 laptop:pt-6 laptop:pb-16">
      <AppBadge count={view.badge} />
      {/* Header */}
      <header className="px-5 pt-2 laptop:px-0">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[13px] font-medium text-ink-3" data-testid="today-date" title={view.timeZone}>
            {view.shortDate}
            {view.cycleDay ? ` · ${view.cycleDay}` : ""}
          </span>
          <Link
            href="/app/me"
            aria-label="Me"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-[13px] font-semibold text-ink laptop:hidden"
          >
            {initials}
          </Link>
        </div>
        <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Today</h1>
        <div className="mt-3.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${progress.total}, minmax(0, 1fr))` }} aria-hidden data-testid="today-progress">
          {progress.segments.map((segment, index) => (
            <i key={index} data-segment={segment} className={cn("block h-1.5 rounded-[3px]", segment === "done" ? "bg-ink" : segment === "due" ? "bg-signal" : "bg-line")} />
          ))}
        </div>
        <div className="mt-2 flex justify-between gap-3 text-[13px] font-semibold">
          <span data-testid="today-done">{progress.label}</span>
          {progress.overdueLabel ? (
            <span className="text-missed" data-testid="today-overdue-count">
              {progress.overdueLabel}
            </span>
          ) : null}
        </div>
      </header>

      {view.requested?.notice ? (
        <p role="status" className="mx-3 mt-4 rounded-[14px] bg-low-tint px-4 py-3 text-[14px] font-medium laptop:mx-0">
          {view.requested.notice}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 px-3 laptop:grid laptop:grid-cols-12 laptop:items-start laptop:gap-6 laptop:px-0">
        {/* Left: Now, overdue, check-in */}
        <div className="flex flex-col gap-3 laptop:col-span-7">
          {!view.hasCycles ? <EmptyToday body={notes.noCyclesBody} /> : null}
          {view.hasCycles && notes.nothingDue && view.now?.mode !== "due" && view.now?.mode !== "later" ? (
            <section className="rounded-[20px] border border-line bg-surface px-4 py-3.5" data-testid="today-quiet">
              <div className="text-[17px] font-semibold">{notes.nothingDue.title}</div>
              <div className="mt-0.5 text-[14px] text-ink-2">{notes.nothingDue.body}</div>
            </section>
          ) : null}
          {nowItem ? (
            <NowCard
              item={nowItem}
              detail={view.doses[nowItem.key]}
              mode={view.now!.mode}
              today={view.today}
              saving={busy?.key === nowItem.key && busy.kind === "confirm"}
              disabled={disabled}
              onTaken={() => quick(nowItem.key)}
              onDetails={() => openSheet(nowItem.key)}
            />
          ) : null}

          {overdue.length ? (
            <div className="flex flex-col gap-2" aria-label="Overdue" role="group">
              {overdue.map((item) => (
                <StatusRow
                  key={item.key}
                  tone="overdue"
                  testId="today-overdue"
                  title={
                    <>
                      {item.peptideName} <span className="font-normal text-ink-2">· {massLabel(item.doseMg)}</span>
                    </>
                  }
                  status={`Not logged · ${wallWhen(`${item.localDate}T${item.localTime}`, "")}`}
                  action={
                    <span className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="md"
                        className="hidden laptop:inline-flex"
                        disabled={disabled}
                        saving={busy?.key === item.key && busy.kind === "skip"}
                        onClick={() => skip(view.doses[item.key], false)}
                      >
                        Mark skipped
                      </Button>
                      <Button variant="outline" size="md" disabled={disabled} onClick={() => openSheet(item.key)}>
                        Log
                      </Button>
                    </span>
                  }
                />
              ))}
            </div>
          ) : null}

          {!checkIn.done ? (
            <CheckInCard
              onPick={(feeling) => {
                setCheckInFeeling(feeling);
                setCheckInOpen(true);
              }}
            />
          ) : null}
        </div>

        {/* Right: the day rail, the next doses, supplies */}
        <div className="flex flex-col laptop:col-span-5 laptop:gap-5">
          {rail.length ? (
            <section aria-labelledby="today-schedule" className="mt-4 laptop:mt-0 laptop:rounded-group laptop:border laptop:border-line laptop:bg-surface laptop:px-4 laptop:pt-4 laptop:pb-2">
              <div className="flex items-baseline justify-between px-2 laptop:px-0">
                <h2 id="today-schedule" className="text-[20px] font-semibold tracking-[-0.015em]">
                  Schedule
                </h2>
                <span className="font-mono text-[13px] font-medium text-ink-3">{rail.length} today</span>
              </div>
              <ol className="mt-1.5 flex flex-col px-2 laptop:px-0">
                {rail.map((entry, index) => (
                  <RailRow
                    key={entry.key}
                    entry={entry}
                    first={index === 0}
                    last={index === rail.length - 1}
                    nowMs={nowMs}
                    inNowBlock={entry.type === "dose" && entry.dose.key === nowItem?.key && canTakeNow}
                    disabled={disabled}
                    busy={entry.type === "dose" ? busy?.key === entry.dose.key && busy.kind === "confirm" : supplement.busy(entry.row.key)}
                    onOpenDose={openSheet}
                    onTakeDose={quick}
                    onTakeSupplement={(detail) => supplement.take(detail, null)}
                    onOpenSupplement={setSupplementSheet}
                  />
                ))}
              </ol>
            </section>
          ) : null}

          {next.length ? (
            <section aria-labelledby="today-next" className="mt-6 laptop:mt-0">
              <h2 id="today-next" className="px-2 text-[20px] font-semibold tracking-[-0.015em] laptop:px-0">
                Coming up
              </h2>
              <ul className="mt-2 flex flex-col gap-0 overflow-hidden rounded-group border border-line bg-surface">
                {next.map((item, index) => (
                  <NextRow key={item.key} item={item} today={view.today} divided={index > 0} />
                ))}
              </ul>
            </section>
          ) : null}

          {lowVials.length ? (
            <section aria-labelledby="today-supplies" className="mt-6 flex flex-col gap-2 laptop:mt-0">
              <h2 id="today-supplies" className="px-2 text-[20px] font-semibold tracking-[-0.015em] laptop:px-0">
                Supplies
              </h2>
              {lowVials.map((vial) => (
                <StatusRow key={vial.vialId} tone="low" title={vial.title} status={vial.status} href="/app/supplies" testId="today-low" />
              ))}
            </section>
          ) : null}

          {view.hasCycles ? <p className="mt-6 px-2 text-[13px] text-ink-3 laptop:mt-0 laptop:px-0">{ENDED_NOTE}</p> : null}
        </div>
      </div>

      <LogSheet
        detail={sheetDetail}
        open={sheetKey !== null}
        onOpenChange={(open) => (open ? null : closeSheet())}
        sites={view.sites}
        pending={busy && sheetKey === busy.key ? busy.kind : null}
        error={sheetError}
        notice={sheetNotice}
        onSubmit={(submission) => sheetDetail && confirm(sheetDetail, submission, true)}
        onSkip={() => sheetDetail && skip(sheetDetail, true)}
      />
      <CheckInSheet open={checkInOpen} feeling={checkInFeeling} context={checkIn} onClose={() => setCheckInOpen(false)} />
      <SupplementSheet
        detail={supplementSheet}
        onClose={() => setSupplementSheet(null)}
        pending={supplement.pending}
        onSubmit={(detail, actual, onError) => supplement.take(detail, actual, { onDone: () => setSupplementSheet(null), onError })}
      />
    </main>
  );
}

// ── Now block ────────────────────────────────────────────────────────────────

function NowCard({
  item,
  detail,
  mode,
  today,
  saving,
  disabled,
  onTaken,
  onDetails,
}: {
  item: TodayDose;
  detail: DoseDetail;
  mode: "due" | "later" | "next";
  today: string;
  saving: boolean;
  disabled: boolean;
  onTaken: () => void;
  onDetails: () => void;
}) {
  const { draw, setup } = item;
  const pill =
    mode === "due" ? (
      <span className="flex h-[26px] items-center gap-1.5 rounded-full bg-signal px-2.5 text-[13px] font-semibold text-on-signal">
        <i className="size-1.5 rounded-full bg-on-signal" aria-hidden />
        Due now
      </span>
    ) : (
      <span className="flex h-[26px] items-center rounded-full bg-[color-mix(in_oklab,currentColor_14%,transparent)] px-2.5 text-[13px] font-semibold text-surface">
        {mode === "later" ? "Later today" : "Next"}
      </span>
    );
  const when = mode === "next" ? wallWhen(`${item.localDate}T${item.localTime}`, today) : clock12(item.localTime);
  return (
    <NowBlock aria-label={mode === "next" ? "Next dose" : "Next due"} data-testid="today-hero" data-mode={mode} className="laptop:px-7 laptop:pt-6 laptop:pb-6">
      <NowHeader pill={pill} time={when} context={item.cycleName} />
      <div className="mt-4 text-[22px] font-semibold tracking-[-0.015em]" data-testid="hero-name">
        {item.peptideName}
      </div>
      <div className="mt-0.5 text-[14px] text-on-ink-2">
        {massLabel(item.doseMg)}{item.schedule ? ` · ${item.schedule}` : ""}
      </div>
      {draw.kind === "units" && setup ? (
        <>
          <NowReading
            className="mt-3.5"
            value={<span data-testid="hero-units">{draw.units}</span>}
            unit="units"
            secondary={`${draw.volume} mL`}
            caption={`${setup.syringe}-unit syringe`}
          />
          <SyringeRuler className="mt-[18px]" units={draw.units} capacity={setup.syringe} lineSpacing={setup.lineSpacing} onInk notes={false} />
          {draw.flag ? (
            <p role="alert" className="mt-2 text-[13px] font-medium text-on-ink-2">
              {draw.flag}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <NowReading className="mt-3.5" size="m" value={<span data-testid="hero-mg">{massLabel(item.doseMg)}</span>} />
          <p className="mt-3 text-[13px] text-on-ink-2">
            {draw.kind === "error" ? `Units can't be calculated with your saved mixture: ${draw.message}` : NO_MIXTURE_NOTE}{" "}
            <Link href={detail.calculatorHref} className="font-semibold text-surface underline underline-offset-2">
              {draw.kind === "error" ? "Check it in the calculator" : "Set one up in the calculator"}
            </Link>
            {mode === "next" ? "" : " — you can still log Taken."}
          </p>
        </>
      )}
      {item.stockNote ? (
        <p className="mt-3 text-[13px] font-semibold text-surface" data-testid="today-stock">
          {item.stockNote} ·{" "}
          <Link href="/app/supplies" className="underline underline-offset-2">
            Personal supplies
          </Link>
        </p>
      ) : null}
      {mode !== "next" ? (
        <>
          <NowActions className="laptop:mt-5 laptop:[&>*:first-child]:w-[240px] laptop:[&>*:first-child]:flex-none">
            <Button size="lg" onClick={onTaken} saving={saving} disabled={disabled}>
              <Check aria-hidden />
              Taken
            </Button>
            <Button variant="ghost-on-ink" size="lg" onClick={onDetails}>
              <span className="laptop:hidden">Details</span>
              <span className="hidden laptop:inline">Add time, site or note</span>
            </Button>
          </NowActions>
          <p className="mt-3 hidden font-mono text-[12px] text-on-ink-2 laptop:block">Press T to log</p>
        </>
      ) : null}
    </NowBlock>
  );
}

// ── Check-in card ────────────────────────────────────────────────────────────

function CheckInCard({ onPick }: { onPick: (feeling: number) => void }) {
  return (
    <section
      aria-labelledby="today-checkin"
      className="rounded-[24px] border border-line bg-surface p-4 laptop:flex laptop:items-center laptop:gap-6"
      data-testid="today-checkin"
    >
      <div className="flex items-baseline justify-between laptop:block laptop:min-w-0 laptop:flex-1">
        <h2 id="today-checkin" className="text-[17px] font-semibold">
          How do you feel today?
        </h2>
        <span className="font-mono text-[12px] font-medium text-ink-3">Check-in</span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5 laptop:mt-0 laptop:w-[340px]">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onPick(value)}
            aria-label={`${value} · ${FEELING_WORDS[value]}`}
            className="flex h-[58px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[14px] bg-sunken text-ink transition-transform active:scale-98"
          >
            <b className="text-[18px] font-semibold">{value}</b>
            <span className="text-[12px] text-ink-2">{FEELING_WORDS[value]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ── The day rail ─────────────────────────────────────────────────────────────

const glyphOf = (dose: TodayDose, nowMs: number): GlyphState =>
  dose.state === "taken" ? "done" : dose.state === "skipped" ? "skipped" : Date.parse(dose.scheduledAt) <= nowMs ? "due" : "upcoming";

function RailRow({
  entry,
  first,
  last,
  nowMs,
  inNowBlock,
  disabled,
  busy,
  onOpenDose,
  onTakeDose,
  onTakeSupplement,
  onOpenSupplement,
}: {
  entry: RailEntry;
  first: boolean;
  last: boolean;
  nowMs: number;
  /** The Now block's dose: its Taken is up there. */
  inNowBlock: boolean;
  disabled: boolean;
  busy: boolean;
  onOpenDose: (key: string) => void;
  onTakeDose: (key: string) => void;
  onTakeSupplement: (detail: SupplementDetail) => void;
  onOpenSupplement: (detail: SupplementDetail) => void;
}) {
  const line = (
    <i
      aria-hidden
      className={cn("absolute left-[11px] w-0.5 bg-line", first ? "top-6" : "top-0", last ? "h-3" : "bottom-0", first && last && "hidden")}
    />
  );
  if (entry.type === "supplement") return <SupplementRail row={entry.row} line={line} disabled={disabled} busy={busy} onTake={onTakeSupplement} onOpen={onOpenSupplement} />;

  const { dose } = entry;
  const glyph = glyphOf(dose, nowMs);
  const dueNow = glyph === "due";
  const units = dose.draw.kind === "units" ? `${dose.draw.units} units` : null;
  let status: React.ReactNode;
  let statusText: string;
  if (dose.state === "taken" && dose.actualAt) {
    const at = clock12(wallOf(dose.actualAt, dose.timeZone).slice(11, 16));
    const amount = dose.amountMg && dose.amountMg !== dose.doseMg ? `${massLabel(dose.amountMg)} of ${massLabel(dose.doseMg)}` : null;
    statusText = ["Taken " + at, amount, dose.site].filter(Boolean).join(" · ");
    status = (
      <>
        <b className="font-semibold text-ink">Taken {at}</b>
        {[amount, dose.site].filter(Boolean).map((part) => ` · ${part}`)}
      </>
    );
  } else if (dose.state === "skipped") {
    statusText = "Skipped";
    status = "Skipped";
  } else if (dueNow) {
    statusText = "Due now";
    status = <span className="font-semibold text-signal-ink">Due now</span>;
  } else {
    statusText = untilLabel(Date.parse(dose.scheduledAt) - nowMs);
    status = statusText;
  }
  return (
    <li
      className={cn("relative grid grid-cols-[64px_24px_minmax(0,1fr)_auto] items-start gap-3", dueNow && "-mx-2.5 rounded-[14px] bg-signal-tint px-2.5")}
      data-testid="today-row"
      data-kind="today"
      data-status={statusText}
    >
      <span className={cn("pt-3.5 font-mono text-[13px] font-medium", dueNow ? "font-semibold text-signal-ink" : "text-ink-3")}>{clock12(dose.localTime)}</span>
      <span className="relative flex min-h-16 justify-center pt-3">
        {line}
        <StateGlyph state={glyph} className="relative" />
      </span>
      <button type="button" onClick={() => onOpenDose(dose.key)} className="min-w-0 cursor-pointer py-3 text-left">
        <span className="block text-[16px] font-semibold" data-testid="today-row-title">
          {dose.peptideName}{" "}
          <span className="font-normal text-ink-2">
            · {massLabel(dose.doseMg)}{units ? " · " : ""}
          </span>
          {units ? <span className="font-mono text-[15px] font-medium">{units}</span> : null}
        </span>
        <span className="mt-0.5 block text-[13px] text-ink-2" data-testid="today-row-status">
          {status}
        </span>
        {dose.stockNote && dose.state === "due" ? (
          <span className="mt-0.5 block text-[13px] font-semibold text-low" data-testid="today-stock">
            {dose.stockNote}
          </span>
        ) : null}
      </button>
      {dose.state === "due" && !inNowBlock ? (
        <span className="self-center">
          <Button variant="outline" size="sm" disabled={disabled} saving={busy} onClick={() => onTakeDose(dose.key)}>
            Taken
          </Button>
        </span>
      ) : (
        <span />
      )}
    </li>
  );
}

function SupplementRail({
  row,
  line,
  disabled,
  busy,
  onTake,
  onOpen,
}: {
  row: SupplementRow;
  line: React.ReactNode;
  disabled: boolean;
  busy: boolean;
  onTake: (detail: SupplementDetail) => void;
  onOpen: (detail: SupplementDetail) => void;
}) {
  const { detail } = row;
  const glyph: GlyphState = row.state === "taken" ? "done" : row.state === "due" ? "due" : "upcoming";
  const body = (
    <>
      <span className="block text-[16px] font-semibold">
        {row.title} <span className="font-normal text-ink-2">· {row.amountLabel}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-2">
        {row.takenTime ? (
          <span data-testid="supplement-status">
            <b className="font-semibold text-ink">Taken {clock12(row.takenTime)}</b>
          </span>
        ) : null}
        {row.takenTime ? " · " : null}
        <Pill className="size-3.5" aria-hidden />
        Supplement
        {!row.takenTime ? ` · ${row.state === "due" ? "Due" : "Later today"}` : ""}
      </span>
    </>
  );
  return (
    <li className="relative grid grid-cols-[64px_24px_minmax(0,1fr)_auto] items-start gap-3" data-testid="today-supplement" data-kind="supplement">
      <span className="pt-3.5 font-mono text-[13px] font-medium text-ink-3">{clock12(row.time)}</span>
      <span className="relative flex min-h-16 justify-center pt-3">
        {line}
        <StateGlyph state={glyph} className="relative" />
      </span>
      {detail ? (
        <button type="button" onClick={() => onOpen(detail)} className="min-w-0 cursor-pointer py-3 text-left" aria-label={`${row.title}: another time`}>
          {body}
        </button>
      ) : (
        <div className="min-w-0 py-3">{body}</div>
      )}
      {detail ? (
        <span className="self-center">
          <Button variant="outline" size="sm" disabled={disabled} saving={busy} onClick={() => onTake(detail)}>
            Taken
          </Button>
        </span>
      ) : (
        <span />
      )}
    </li>
  );
}

// ── Each plan's next dose (Marco's rule: kept on Today) ──────────────────────

function NextRow({ item, today, divided }: { item: TodayDose; today: string; divided: boolean }) {
  const units = item.draw.kind === "units" ? `${item.draw.units} units` : null;
  const interval = item.schedule.startsWith("every") || item.schedule === "Daily";
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", divided && "border-t border-line")} data-testid="today-row" data-kind="next" data-status="Next">
      <StateGlyph state="upcoming" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold" data-testid="today-row-title">
          {item.peptideName}{" "}
          <span className="font-normal text-ink-2">
            · {massLabel(item.doseMg)}{units ? " · " : ""}
          </span>
          {units ? <span className="font-mono text-[15px] font-medium">{units}</span> : null}
        </span>
        <span className="mt-0.5 block text-[13px] text-ink-2">
          {wallWhen(`${item.localDate}T${item.localTime}`, today)} · {item.cycleName}
          {interval && item.schedule !== "Daily" ? " · counted from the last actual dose" : ""}
        </span>
        {item.stockNote ? (
          <span className="mt-0.5 block text-[13px] font-semibold text-low" data-testid="today-stock">
            {item.stockNote}
          </span>
        ) : null}
      </span>
    </li>
  );
}

// ── R9a empty ────────────────────────────────────────────────────────────────

function EmptyToday({ body }: { body: string }) {
  return (
    <section className="flex flex-col items-start rounded-[24px] border-[1.5px] border-dashed border-line px-5 py-6" data-testid="today-empty">
      <div className="flex items-baseline gap-2">
        <span className="text-[56px] leading-none font-semibold tracking-[-0.05em]">0</span>
        <span className="font-mono text-[15px] text-ink-3">doses today</span>
      </div>
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.015em]">No cycle running</h2>
      <p className="mt-1 text-[15px] leading-[22px] text-ink-2" data-testid="today-empty-body">
        {body}
      </p>
      <div className="mt-4 flex w-full gap-2">
        <Link href="/app/cycles/new" className={cn(buttonVariants({ variant: "ink", size: "md" }), "flex-1")}>
          Build a cycle
        </Link>
        <Link href="/app/library" className={cn(buttonVariants({ variant: "outline", size: "md" }), "flex-1")}>
          Templates
        </Link>
      </div>
    </section>
  );
}
