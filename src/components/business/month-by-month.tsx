"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type MonthByMonthRow = {
  month: string;
  name: string;
  current: boolean;
  grossProfit: string;
  negative: boolean;
  meta: string;
  change: { direction: "up" | "down" | "flat"; amount: string };
  /** "vs Aug 1–24" on the current month (compared on the same days). */
  vs: string | null;
};

const SHOWN = 6;
const ARROWS = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/** A13 Month by month: newest first, the last 6 months, then "Show all 12 months". */
export function MonthByMonth({ rows }: { rows: MonthByMonthRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <>
      <div className="mx-5 flex flex-col divide-y divide-line" data-testid="month-rows">
        {shown.map((row) => {
          const Arrow = ARROWS[row.change.direction];
          return (
            <div key={row.month} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-3" data-testid="month-row">
              <span className="text-[15px] font-semibold">
                {row.name} {row.current ? <span className="font-normal text-ink-3">to date</span> : null}
              </span>
              <span className={cn("text-right text-[15px] font-semibold", row.negative && "text-missed")}>{row.grossProfit}</span>
              <span className="font-mono text-[12px] font-medium text-ink-3">{row.meta}</span>
              <span className="flex items-center justify-end gap-[3px] text-right text-[12px] text-ink-2">
                {row.vs ? `${row.vs} ` : null}
                <Arrow className="size-3 shrink-0" aria-hidden />
                <span className="sr-only">{row.change.direction === "flat" ? "no change" : row.change.direction} </span>
                {row.change.amount}
              </span>
            </div>
          );
        })}
      </div>
      {rows.length > SHOWN ? (
        <div className="mx-3 mt-1">
          <button
            type="button"
            onClick={() => setAll((open) => !open)}
            aria-expanded={all}
            className="h-11 w-full cursor-pointer rounded-[12px] border border-line bg-surface text-[15px] font-semibold"
          >
            {all ? "Show the last 6 months" : `Show all ${rows.length} months`}
          </button>
        </div>
      ) : null}
    </>
  );
}
