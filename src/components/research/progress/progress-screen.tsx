"use client";

import { ArrowDownRight, ArrowUpRight, ChevronDown, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/alpha/button";
import { Group } from "@/components/alpha/list";
import { NowBlock } from "@/components/alpha/now-block";
import { SegmentedLinks } from "@/components/alpha/segmented";
import { NO_CYCLE_OPTION, NOT_EVIDENCE } from "@/lib/progress/rules";
import { NO_CYCLE_PARAM, type ProgressRange, type ProgressScreen as Screen } from "@/lib/progress/screen";
import { cn } from "@/lib/utils";
import { CheckInSheet, type CheckInContext } from "../check-in-sheet";
import { CYCLES_MAIN } from "../cycles/cycles-list";
import { Axis, DoseLanes, FeelingBars, FeelingChart, MeasureChart } from "./charts";

/** Check-in rows the phone shows before "See all". */
const PHONE_ROWS = 5;
const RANGE_LABELS: Record<ProgressRange, string> = { "7d": "7 days", "30d": "30 days", cycle: "Cycle" };

/** The page's own URL with a new range or cycle (the other one kept). */
function hrefWith(screen: Screen, change: { range?: ProgressRange; cycle?: string }): string {
  const params = new URLSearchParams();
  const range = change.range ?? screen.range;
  const cycle = change.cycle ?? screen.cycleId ?? NO_CYCLE_PARAM;
  params.set("range", range);
  params.set("cycle", cycle);
  return `/app/progress?${params.toString()}`;
}

/**
 * R5 Progress (phone) and D3 (laptop), design v3: the feeling over the
 * range with its average and change, the selected cycle's doses as lanes
 * under it, the latest measurement, adherence / check-ins / effects, the
 * unwanted effects reported and the check-ins themselves (D3: a table with
 * Export CSV). Today's check-in is made or edited here too (R6's sheet).
 * Without a cycle, check-ins only; without measurements, no measurement card.
 */
export function ProgressScreen({ screen, checkIn }: { screen: Screen; checkIn: CheckInContext }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const { feeling, tiles, measure } = screen;
  const phoneRows = allRows ? screen.rows : screen.rows.slice(0, PHONE_ROWS);
  const ranges = screen.ranges.map((range) => ({ key: range, label: RANGE_LABELS[range], href: hrefWith(screen, { range }) }));
  const checkInLabel = screen.todayCheckIn ? "Edit today's check-in" : "Check in";

  return (
    <main className={CYCLES_MAIN}>
      <header className="flex flex-col px-5 pt-2 laptop:flex-row laptop:items-end laptop:gap-4 laptop:px-0">
        <div className="min-w-0">
          <CyclePicker screen={screen} onPick={(cycle) => router.push(hrefWith(screen, { cycle }))} />
          <div className="flex items-center justify-between gap-3">
            <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Progress</h1>
            <Button variant="outline" size="sm" className="laptop:hidden" onClick={() => setSheetOpen(true)} data-testid="progress-check-in">
              {checkInLabel}
            </Button>
          </div>
        </div>
        <SegmentedLinks links={ranges} current={screen.range} label="Range" className="mt-3.5 laptop:hidden" />
        <div className="ml-auto hidden items-center gap-3 laptop:flex">
          <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)} data-testid="progress-check-in-laptop">
            {checkInLabel}
          </Button>
          <SegmentedLinks links={ranges} current={screen.range} label="Range (laptop)" size="sm" className="w-[300px]" />
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-3 px-3 laptop:grid laptop:grid-cols-12 laptop:gap-4 laptop:px-0">
        <NowBlock aria-label="Feeling" className="laptop:col-span-8 laptop:px-6 laptop:pt-5" data-testid="progress-now">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-on-ink-2" data-testid="feeling-label">
              {feeling.label}
            </span>
            <span className="font-mono text-[12px] font-medium text-on-ink-2">{feeling.rangeLabel}</span>
          </div>
          <div className="mt-2.5 flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <span className="text-[80px] leading-[0.8] font-semibold tracking-[-0.055em] laptop:text-[72px]" data-testid="feeling-average">
                {feeling.average ?? "—"}
              </span>
              <span className="font-mono text-[18px] text-on-ink-2">/ 5</span>
            </div>
            <div className="text-right" data-testid="feeling-change">
              {feeling.change ? (
                <>
                  <div className="flex items-center justify-end gap-1 text-base font-semibold">
                    {feeling.change.direction === "up" ? <ArrowUpRight className="size-4" aria-hidden /> : null}
                    {feeling.change.direction === "down" ? <ArrowDownRight className="size-4" aria-hidden /> : null}
                    {feeling.change.text}
                  </div>
                  <div className="text-[13px] text-on-ink-2">{feeling.change.caption}</div>
                </>
              ) : (
                <div className="max-w-[150px] text-[13px] text-on-ink-2">{feeling.average ? "Not enough check-ins to compare" : "No check-ins in this range"}</div>
              )}
            </div>
          </div>
          <div className="mt-[18px] grid grid-cols-[62px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5">
            <span className="flex h-[112px] flex-col justify-between self-stretch pb-1 font-mono text-[12px] font-medium text-on-ink-2 laptop:h-[150px]" aria-hidden>
              <span>5 Great</span>
              <span>3 OK</span>
              <span>1 Rough</span>
            </span>
            <FeelingChart points={feeling.points} preCycle={feeling.preCycle} className="h-[112px] laptop:h-[150px]" />
            <DoseLanes tracks={screen.tracks} />
            <span />
            <div className="mt-1.5">
              <div className="laptop:hidden">
                <Axis labels={feeling.axis} />
              </div>
              <div className="hidden laptop:block">
                <Axis labels={feeling.axis} wide />
              </div>
            </div>
          </div>
        </NowBlock>

        <div className="flex flex-col gap-3 laptop:col-span-4">
          {measure ? (
            <section aria-label={measure.name} className="rounded-[24px] border border-line bg-surface p-4 laptop:px-[18px]" data-testid="measure-card">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-ink-2">{measure.name}</span>
                <span className="font-mono text-[12px] font-medium text-ink-3">{measure.entries}</span>
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-[34px] leading-none font-semibold tracking-[-0.03em] laptop:text-[32px]" data-testid="measure-latest">
                    {measure.latest}
                  </span>
                  <span className="font-mono text-[15px] font-medium text-ink-2">{measure.unit}</span>
                </div>
                {measure.change ? (
                  <div className="text-right" data-testid="measure-change">
                    <div className="flex items-center justify-end gap-1 text-[15px] font-semibold">
                      {measure.change.direction === "up" ? <ArrowUpRight className="size-[15px]" aria-hidden /> : null}
                      {measure.change.direction === "down" ? <ArrowDownRight className="size-[15px]" aria-hidden /> : null}
                      {measure.change.text}
                    </div>
                    <div className="text-[13px] text-ink-3">{measure.change.since}</div>
                  </div>
                ) : null}
              </div>
              <MeasureChart points={measure.points} preCycle={feeling.preCycle} className="mt-3 h-[88px] laptop:h-[90px]" />
              <div className="mt-1.5 flex justify-between font-mono text-[12px] font-medium text-ink-3">
                <span>{measure.max}</span>
                <span>{measure.min}</span>
              </div>
            </section>
          ) : (
            <section aria-label="Measurements" className="rounded-[24px] border border-line bg-surface p-4 laptop:px-[18px]" data-testid="measure-empty">
              <div className="text-[13px] font-medium text-ink-2">Measurements</div>
              <p className="mt-1.5 text-[15px] leading-[21px] text-ink-2">
                None in this range. Add weight, waist or sleep to a check-in and it charts here.
              </p>
            </section>
          )}

          <div className="grid grid-cols-3 gap-2 laptop:grid-cols-2 laptop:gap-3">
            <Tile label="Adherence" value={tiles.adherence?.value ?? "—"} unit={tiles.adherence?.unit} context={tiles.adherence?.context ?? "No cycle selected"} testId="tile-adherence" />
            <Tile label="Check-ins" value={tiles.checkIns.value} context={tiles.checkIns.context} testId="tile-check-ins" />
            <Tile label="Effects" value={tiles.effects.value} context={tiles.effects.context} testId="tile-effects" className="laptop:hidden" />
          </div>
        </div>

        <section aria-labelledby="progress-check-ins" className="mt-4 laptop:col-span-8 laptop:mt-0 laptop:self-start laptop:rounded-[24px] laptop:border laptop:border-line laptop:bg-surface laptop:px-6 laptop:pt-3.5 laptop:pb-2">
          <div className="mx-2 mb-1 flex items-baseline justify-between laptop:mx-0">
            <h2 id="progress-check-ins" className="text-[20px] font-semibold tracking-[-0.015em] laptop:text-base">
              Check-ins
            </h2>
            <span className="flex items-baseline gap-4">
              <a href={screen.exportHref} download className="hidden text-[14px] font-semibold text-signal-ink laptop:inline" data-testid="export-csv">
                Export CSV
              </a>
              {screen.rows.length > PHONE_ROWS ? (
                <button type="button" className="cursor-pointer text-[15px] font-semibold text-signal-ink laptop:hidden" onClick={() => setAllRows(!allRows)} aria-expanded={allRows}>
                  {allRows ? "Show fewer" : "See all"}
                </button>
              ) : null}
            </span>
          </div>
          {screen.rows.length ? (
            <>
              <ol className="mx-2 flex flex-col laptop:hidden" aria-label="Check-ins in this range">
                {phoneRows.map((row) => (
                  <li key={row.day} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-line py-3 last:border-b-0" data-testid="progress-row" data-day={row.day}>
                    <span className="pt-0.5 font-mono text-[13px] font-medium text-ink-2">{row.date}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[15px] font-semibold">
                        <FeelingBars feeling={row.feeling} />
                        <span data-slot="feeling">{row.feelingText}</span>
                      </span>
                      {row.note ? <span className="mt-1 block text-[14px] leading-5 text-ink-2">{row.note}</span> : null}
                      {row.effects || row.measure ? (
                        <span className="mt-1 block text-[13px] text-ink-3">{[row.effects, row.measure].filter(Boolean).join(" · ")}</span>
                      ) : null}
                      {row.phase || row.doses ? (
                        <span className="mt-0.5 block font-mono text-[12px] text-ink-3" data-slot="beside">
                          {[row.phase, row.doses].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
              <CheckInTable screen={screen} />
              <a href={screen.exportHref} download className="mx-2 mt-2 inline-flex h-11 items-center gap-2 text-[15px] font-semibold text-signal-ink laptop:hidden" data-testid="export-csv-phone">
                <Download className="size-4" aria-hidden />
                Export CSV
              </a>
            </>
          ) : (
            <p className="mx-2 py-3 text-[15px] leading-[22px] text-ink-2 laptop:mx-0" data-testid="progress-empty">
              No check-ins in this range. One a day is enough — gaps stay gaps, never zeros.
            </p>
          )}
        </section>

        <section aria-labelledby="progress-effects" className="mt-4 laptop:col-span-4 laptop:mt-0 laptop:self-start laptop:rounded-[24px] laptop:border laptop:border-line laptop:bg-surface laptop:px-5 laptop:pt-3.5 laptop:pb-1">
          <h2 id="progress-effects" className="mx-2 mb-2 text-[20px] font-semibold tracking-[-0.015em] laptop:mx-0 laptop:mb-1.5 laptop:text-base">
            Unwanted effects
          </h2>
          {screen.effects.length ? (
            <Group className="laptop:rounded-none laptop:border-0 laptop:bg-transparent">
              {screen.effects.map((effect) => (
                <div key={effect.label} className="flex items-center gap-3 px-4 py-3 laptop:px-0" data-testid="effect-row">
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold laptop:text-[14px]">{effect.label}</span>
                    <span className="mt-0.5 block font-mono text-[12px] text-ink-3">{effect.dates}</span>
                  </span>
                  <span className="shrink-0 text-[15px] font-semibold laptop:text-[14px]">{effect.count}</span>
                </div>
              ))}
            </Group>
          ) : (
            <p className="mx-2 py-2 text-[15px] text-ink-2 laptop:mx-0">None reported in this range.</p>
          )}
        </section>
      </div>

      <p className="mx-5 mt-6 text-[13px] leading-[19px] text-ink-3 laptop:mx-0">
        {screen.sparse ? `${screen.sparse} ` : ""}
        {NOT_EVIDENCE}.
      </p>

      <CheckInSheet open={sheetOpen} feeling={null} start={screen.todayCheckIn} context={checkIn} onClose={() => setSheetOpen(false)} />
    </main>
  );
}

/** The mono "cycle · day" line, which also picks the cycle (a native select over it). */
function CyclePicker({ screen, onPick }: { screen: Screen; onPick: (cycle: string) => void }) {
  if (!screen.cycles.length)
    return (
      <div className="font-mono text-[13px] font-medium text-ink-3" data-testid="progress-header">
        {screen.header}
      </div>
    );
  return (
    <label className="relative inline-flex max-w-full items-center gap-1 font-mono text-[13px] font-medium text-ink-3">
      <span className="truncate" data-testid="progress-header">
        {screen.header}
      </span>
      <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      <select
        aria-label="Cycle"
        value={screen.cycleId ?? NO_CYCLE_PARAM}
        onChange={(event) => onPick(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none text-base leading-none opacity-0"
      >
        {screen.cycles.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {cycle.name}
          </option>
        ))}
        <option value={NO_CYCLE_PARAM}>{NO_CYCLE_OPTION}</option>
      </select>
    </label>
  );
}

function Tile({ label, value, unit, context, testId, className }: { label: string; value: string; unit?: string; context: string; testId: string; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-group border border-line bg-surface p-3.5 laptop:px-4", className)} data-testid={testId}>
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className="mt-2 flex items-baseline gap-0.5 laptop:mt-1.5">
        <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] laptop:text-[26px]" data-slot="value">
          {value}
        </span>
        {unit ? <span className="font-mono text-[14px] font-medium text-ink-2">{unit}</span> : null}
      </div>
      <div className="mt-1 truncate text-[12px] text-ink-3" data-slot="context">
        {context}
      </div>
    </div>
  );
}

/** D3's check-in table: Date, Feeling, Unwanted, the measurement, Note. */
function CheckInTable({ screen }: { screen: Screen }) {
  const measureName = screen.measure?.name ?? "Measurement";
  const cols = "grid grid-cols-[110px_130px_150px_90px_minmax(0,1fr)] gap-2";
  return (
    <div className="hidden laptop:block" role="table" aria-label="Check-ins in this range">
      <div role="row" className={cn(cols, "border-b border-line pt-2.5 pb-1.5 text-[12px] text-ink-3")}>
        {["Date", "Feeling", "Unwanted", measureName, "Note"].map((head) => (
          <span key={head} role="columnheader">
            {head}
          </span>
        ))}
      </div>
      {screen.rows.map((row) => {
        const measure = row.measureName === measureName ? row.measureValue : row.measure;
        return (
          <div key={row.day} role="row" className={cn(cols, "items-center border-b border-line py-[9px] text-[14px] last:border-b-0")} data-testid="progress-table-row" data-day={row.day}>
            <span role="cell" className="font-mono text-[13px]">
              {row.date}
            </span>
            <span role="cell" className="font-semibold">
              {row.feelingText}
            </span>
            <span role="cell" className={cn("truncate", !row.effects && "text-ink-3")} title={row.effects || undefined}>
              {row.effects || "None"}
            </span>
            <span role="cell" className={cn("truncate", !measure && "text-ink-3")}>
              {measure || "—"}
            </span>
            <span role="cell" className={cn("truncate", row.note ? "text-ink-2" : "text-ink-3")} title={row.note || undefined}>
              {row.note || "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
