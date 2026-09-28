"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { setSupplementTrackingAction } from "@/app/(private)/app/supplements/actions";
import { Button } from "@/components/alpha/button";
import { Group, GroupLabel } from "@/components/alpha/list";
import { type GlyphState, StateGlyph } from "@/components/alpha/state-glyph";
import { useAlphaToast } from "@/components/alpha/toast";
import { clock12 } from "@/lib/alpha/format";
import { GUIDANCE_NOTE, NO_GUIDANCE, NO_ROUTINES, SUPPLEMENTS_INTRO, TRACKING_OFF } from "@/lib/supplements/rules";
import type { GridCell, RoutineCard, SupplementDetail, SupplementsView } from "@/lib/supplements/view";
import { cn } from "@/lib/utils";
import { SupplementSheet } from "../log-sheet";
import { useTakeSupplement } from "../supplement-taken";
import { RoutineSheet } from "./routine-sheet";
import { SUPPLIES_MAIN, SuppliesHeader, TrackingOff, TrackingSwitch, useSheetAction } from "./supplies-shared";

/**
 * R13 Supplies · Supplements (design v3), and its laptop layout: today's
 * occurrences with Taken (primary for the next one due, outline for later
 * ones; a row opens "taken at another time"), the last 7 days as a grid,
 * the routines (tap to edit or end; ended ones are kept, never deleted) and
 * the supplied guidance. The round + adds a routine. Tracking is its own
 * switch, off by default; while off only the switch and the guidance show.
 */
export function SupplementsScreen({ view }: { view: SupplementsView }) {
  const toast = useAlphaToast();
  const tracking = useSheetAction(setSupplementTrackingAction);
  const [target, setTarget] = useState(view.tracking);
  const on = tracking.pending ? target : view.tracking;
  const [editing, setEditing] = useState<RoutineCard | "new" | null>(null);
  const [another, setAnother] = useState<SupplementDetail | null>(null);
  const take = useTakeSupplement((message, tone) => (tone === "error" ? toast.error({ message }) : toast.success({ message })));
  const toggle = (next: boolean) => {
    setTarget(next);
    tracking.run({ enabled: next });
  };
  const active = view.routines.filter((r) => !r.ended);
  const ended = view.routines.filter((r) => r.ended);
  const current = typeof editing === "object" && editing !== null ? (view.routines.find((r) => r.id === editing.id) ?? editing) : editing;

  return (
    <main className={SUPPLIES_MAIN}>
      <SuppliesHeader current="supplements" addLabel="Add routine" onAdd={view.tracking ? () => setEditing("new") : null} />

      {!view.tracking ? (
        <TrackingOff title="Supplement tracking is off" body={TRACKING_OFF} pending={tracking.pending} onTurnOn={() => toggle(true)} testId="supplements-off" />
      ) : (
        <div className="laptop:mt-2 laptop:grid laptop:grid-cols-12 laptop:items-start laptop:gap-6">
          <div className="laptop:col-span-7">
            <section aria-labelledby="supplements-today" className="mt-[22px]">
              <GroupLabel className="flex justify-between laptop:px-0">
                <span id="supplements-today">Today</span>
                <span className="font-mono font-medium" data-testid="supplements-today-count">
                  {view.today.taken} of {view.today.total}
                </span>
              </GroupLabel>
              {view.today.rows.length ? (
                <Group className="mx-3 laptop:mx-0">
                  {view.today.rows.map((row) => {
                    const glyph: GlyphState = row.state === "taken" ? "done" : row.state === "due" ? "due" : "upcoming";
                    const body = (
                      <>
                        <span className="block text-base font-semibold">
                          {row.title} <span className="font-normal text-ink-2">· {row.amountLabel}</span>
                        </span>
                        {row.takenTime ? (
                          <span className="mt-0.5 block text-[13px] font-semibold text-done" data-testid="supplement-status">
                            Taken {clock12(row.takenTime)}
                          </span>
                        ) : (
                          <span className="mt-0.5 block font-mono text-[12px] text-ink-3">{clock12(row.time)}</span>
                        )}
                      </>
                    );
                    return (
                      <div key={row.key} className="flex min-h-16 items-center gap-3 py-2 pr-3 pl-4" data-testid="supplement-today-row" data-state={row.state} data-next={row.next || undefined}>
                        <StateGlyph state={glyph} />
                        {row.detail ? (
                          <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => setAnother(row.detail)} aria-label={`${row.title}: taken at another time`}>
                            {body}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1">{body}</span>
                        )}
                        {row.detail ? (
                          <Button
                            variant={row.next ? "primary" : "outline"}
                            size="md"
                            disabled={take.pending}
                            saving={take.busy(row.key)}
                            onClick={() => take.take(row.detail!, null)}
                            aria-label={`Taken: ${row.title}`}
                          >
                            Taken
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </Group>
              ) : (
                <p className="mx-5 text-[15px] text-ink-2 laptop:mx-0" data-testid="supplements-today-empty">
                  {active.length ? "Nothing to take today." : NO_ROUTINES}
                </p>
              )}
            </section>

            {active.length ? (
              <section aria-labelledby="supplements-routines" className="mt-[22px]">
                <GroupLabel id="supplements-routines" className="laptop:px-0">
                  Routines · {active.length}
                </GroupLabel>
                <Group className="mx-3 laptop:mx-0">
                  {active.map((routine) => (
                    <RoutineRow key={routine.id} routine={routine} onOpen={() => setEditing(routine)} />
                  ))}
                </Group>
              </section>
            ) : null}
            {ended.length ? (
              <section aria-labelledby="supplements-ended" className="mt-[22px]">
                <GroupLabel id="supplements-ended" className="laptop:px-0">
                  Ended · {ended.length}
                </GroupLabel>
                <Group className="mx-3 laptop:mx-0">
                  {ended.map((routine) => (
                    <RoutineRow key={routine.id} routine={routine} onOpen={() => setEditing(routine)} />
                  ))}
                </Group>
              </section>
            ) : null}
          </div>

          <div className="laptop:col-span-5">
            {view.grid.rows.length ? <WeekGridCard view={view} /> : null}
          </div>
        </div>
      )}

      <section aria-labelledby="supplements-guidance" className="mt-7 laptop:max-w-[760px]">
        <GroupLabel id="supplements-guidance" className="laptop:px-0">
          Supplied guidance
        </GroupLabel>
        {view.guidance.length ? (
          <Group className="mx-3 laptop:mx-0" data-testid="guidance">
            {view.guidance.map((entry) => (
              <div key={entry.name} className="px-4 py-3">
                <div className="text-[15px] font-semibold">{entry.name}</div>
                <p className="mt-0.5 text-[14px] leading-5 whitespace-pre-line text-ink-2">{entry.text}</p>
              </div>
            ))}
          </Group>
        ) : (
          <p className="mx-5 text-[14px] text-ink-2 laptop:mx-0" data-testid="guidance">
            {NO_GUIDANCE}
          </p>
        )}
        <p className="mx-5 mt-2 text-[13px] text-ink-3 laptop:mx-0">{GUIDANCE_NOTE}</p>
      </section>

      <TrackingSwitch label="Track supplements" on={on} pending={tracking.pending} onChange={toggle} note={SUPPLEMENTS_INTRO} className="laptop:max-w-[560px]" />

      <RoutineSheet routine={current} onClose={() => setEditing(null)} />
      <SupplementSheet
        detail={another}
        onClose={() => setAnother(null)}
        pending={take.pending}
        onSubmit={(detail, actual, onError) => take.take(detail, actual, { onDone: () => setAnother(null), onError })}
      />
    </main>
  );
}

function RoutineRow({ routine, onOpen }: { routine: RoutineCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]"
      data-testid="routine-card"
      data-ended={routine.ended}
      aria-label={`${routine.name}, ${routine.state}`}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block text-base font-semibold", routine.ended && "text-ink-2")} data-testid="routine-title">
          {routine.title}
        </span>
        <span className="mt-0.5 block text-[13px] text-ink-2" data-testid="routine-state">
          {routine.ended ? routine.state : `${routine.schedule} · ${routine.state}`}
        </span>
        <span className="mt-0.5 block font-mono text-[12px] text-ink-3" data-testid="routine-dates">
          {routine.dates}
        </span>
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
    </button>
  );
}

const CELL: Record<GridCell, string> = {
  taken: "bg-ink",
  missed: "border-[1.5px] border-dashed border-ink-3",
  later: "border-[1.5px] border-line",
  none: "",
};
const CELL_WORD: Record<GridCell, string> = { taken: "taken", missed: "missed", later: "later today", none: "not scheduled" };

/** R13 "Last 7 days": a 16 px cell per routine per day, and the legend. */
function WeekGridCard({ view }: { view: SupplementsView }) {
  const { days, rows } = view.grid;
  return (
    <section aria-labelledby="supplements-week" className="mt-[22px]">
      <GroupLabel id="supplements-week" className="laptop:px-0">
        Last 7 days
      </GroupLabel>
      <div
        className="mx-3 grid grid-cols-[120px_repeat(7,minmax(0,1fr))] items-center gap-x-1 gap-y-1.5 rounded-group border border-line bg-surface px-4 py-3.5 text-[14px] laptop:mx-0"
        role="table"
        aria-label="Supplements taken in the last 7 days"
        data-testid="supplements-grid"
      >
        <div role="row" className="contents">
          <span role="columnheader" />
          {days.map((day) => (
            <span key={day.date} role="columnheader" aria-label={day.date} className={cn("text-center font-mono text-[12px]", day.today ? "font-semibold text-ink" : "font-medium text-ink-3")}>
              {day.letter}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.routineId} role="row" className="contents" data-testid="grid-row">
            <span role="rowheader" className="truncate pr-1">
              {row.name}
            </span>
            {row.cells.map((cell, i) => (
              <i key={days[i].date} role="cell" aria-label={`${days[i].date}: ${CELL_WORD[cell]}`} data-cell={cell} className={cn("h-4 rounded-[4px]", CELL[cell])} />
            ))}
          </div>
        ))}
      </div>
      <div className="mx-5 mt-2.5 flex flex-wrap gap-4 text-[13px] text-ink-2 laptop:mx-0" aria-hidden>
        <span className="flex items-center gap-1.5">
          <i className="size-3 rounded-[3px] bg-ink" />
          Taken
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-3 rounded-[3px] border-[1.5px] border-dashed border-ink-3" />
          Missed
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-3 rounded-[3px] border-[1.5px] border-line" />
          Later today
        </span>
      </div>
    </section>
  );
}
