import Link from "next/link";
import { StateGlyph, type GlyphState } from "@/components/alpha/state-glyph";
import type { HistoryItem } from "@/lib/cycles/screens";
import { cn } from "@/lib/utils";

const GLYPH: Record<HistoryItem["state"], GlyphState> = { taken: "done", missed: "overdue", skipped: "skipped", due: "due" };

const statusWord = (item: HistoryItem) =>
  item.state === "missed" ? "Not logged" : item.state === "skipped" ? "Skipped" : item.state === "due" ? "Due today" : "";

const linkLabel = (item: HistoryItem) => (item.state === "missed" ? "Log late dose" : "Log dose");

/**
 * R3's history rows (phone): glyph, "BPC-157 · 250 mcg" (a missed one adds
 * "· Not logged" in `missed`) and a mono line "Thu, Sep 24 · 7:34 AM ·
 * Abdomen L" (or "· planned 8:00 PM"). A missed or due dose links to its
 * sheet on Today (R2b "Log late").
 */
export function HistoryList({ items, className }: { items: readonly HistoryItem[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-3 last:border-b-0"
          data-testid="history-row"
          data-state={item.state}
        >
          <StateGlyph state={GLYPH[item.state]} />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">
              {item.peptide} · {item.amount}
              {item.planned ? <span className="font-normal text-ink-3"> (planned {item.planned})</span> : null}
              {statusWord(item) ? (
                <span className={cn(item.state === "missed" ? "text-missed" : item.state === "due" ? "text-signal-ink" : "font-medium text-ink-2")}>
                  {" "}
                  · {statusWord(item)}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block font-mono text-[12px] text-ink-3" data-slot="when">
              {[item.date, item.time, item.site].filter(Boolean).join(" · ")}
            </span>
            {item.note ? <span className="mt-0.5 block truncate text-[13px] text-ink-2">{item.note}</span> : null}
          </span>
          {item.logHref ? (
            <Link prefetch={false} href={item.logHref} className="shrink-0 text-[15px] font-semibold text-signal-ink">
              {linkLabel(item)}
            </Link>
          ) : (
            <span />
          )}
        </li>
      ))}
    </ol>
  );
}

/** D2's history table: status, When, Peptide, Amount, Site, Note; a missed dose links to "Log late dose". */
export function HistoryTable({ items }: { items: readonly HistoryItem[] }) {
  const cols = "grid grid-cols-[30px_190px_minmax(0,1fr)_120px_140px_minmax(0,1fr)] items-center gap-x-2";
  return (
    <div role="table" aria-label="History" className="text-[14px]">
      <div role="row" className={cn(cols, "border-b border-line pt-2.5 pb-1.5 text-[12px] text-ink-3")}>
        <span role="columnheader">
          <span className="sr-only">Status</span>
        </span>
        <span role="columnheader">When</span>
        <span role="columnheader">Peptide</span>
        <span role="columnheader">Amount</span>
        <span role="columnheader">Site</span>
        <span role="columnheader">Note</span>
      </div>
      {items.map((item) => (
        <div role="row" key={item.key} className={cn(cols, "border-b border-line py-[9px] last:border-b-0")} data-testid="history-table-row" data-state={item.state}>
          <span role="cell">
            <StateGlyph state={GLYPH[item.state]} size={18} />
            <span className="sr-only">{item.state === "taken" ? "Taken" : statusWord(item)}</span>
          </span>
          <span role="cell" className="font-mono text-[13px]">
            {item.date} · {item.state === "taken" ? item.time : item.time.replace(/^planned /, "")}
          </span>
          <span role="cell" className="truncate font-semibold">
            {item.peptide}
          </span>
          <span role="cell" className={cn(item.state === "missed" && "font-semibold text-missed", item.state === "skipped" && "text-ink-2")}>
            {item.state === "taken" ? item.amount : item.state === "missed" ? "Not logged" : item.state === "skipped" ? "Skipped" : `${item.amount} due`}
            {item.planned ? <span className="text-ink-3"> (planned {item.planned})</span> : null}
          </span>
          <span role="cell" className={item.site ? "text-ink-2" : "text-ink-3"}>
            {item.site || "—"}
          </span>
          <span role="cell" className="truncate">
            {item.logHref ? (
              <Link prefetch={false} href={item.logHref} className="font-semibold text-signal-ink">
                {linkLabel(item)}
              </Link>
            ) : (
              <span className={item.note ? "text-ink-2" : "text-ink-3"}>{item.note || "—"}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
