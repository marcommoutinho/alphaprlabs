"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Search } from "lucide-react";
import { isOnline } from "@/components/alpha/online";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import { buttonVariants } from "@/components/alpha/button-variants";
import { Field, NumberInput } from "@/components/alpha/field";
import { Segmented } from "@/components/alpha/segmented";
import { Sheet, SheetContent } from "@/components/alpha/sheet";
import { StateGlyph } from "@/components/alpha/state-glyph";
import { Tag } from "@/components/alpha/tag";
import { useAlphaToast } from "@/components/alpha/toast";
import { lowCounter, useNavCount } from "@/components/alpha/shell/nav-counts";
import { setStockThresholdAction } from "@/app/(private)/admin/inventory/actions";
import { money } from "@/lib/alpha/format";
import type { StockLevel } from "@/lib/business/service";
import {
  attemptFor,
  avgCost,
  byName,
  DEFAULT_SORT,
  isLow,
  levelOf,
  matchesSearch,
  parseThreshold,
  settles,
  sortStock,
  stockTotals,
  vialCount,
  type StockSort,
  type StockSortKey,
  type ThresholdAttempt,
} from "@/lib/business/stock";
import { cn } from "@/lib/utils";
import { RecordButton } from "@/components/records/record-provider";
import { BUSINESS_MAIN, BUSINESS_PATH } from "./frame";

type Filter = "all" | "low";

/**
 * A3 / D4 Stock (admins only): every stock item with its count and value at
 * cost; low items pinned first with the low glyph, the word and the tint. A
 * phone lists them in two groups; a laptop shows the sortable table (On hand
 * with its level bar and Low tag, Value at cost, Avg cost, Sold 30 d). Tapping
 * an item opens its sheet (a drawer on a laptop), where its reorder level is
 * set. Counts are never shown stale: see the segment's error state (A6c).
 */
export function StockScreen({ items, initialFilter }: { items: StockLevel[]; initialFilter: Filter }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [sort, setSort] = useState<StockSort>(DEFAULT_SORT);
  // The open sheet: its item and this opening's token. A submission that
  // finishes late (a Retry from a toast) closes only the opening it was made
  // in, never one opened later, even for the same item.
  const [sheet, setSheet] = useState<{ itemId: string; token: number } | null>(null);
  const openings = useRef(0);
  const openSheet = useCallback((itemId: string) => {
    openings.current += 1;
    setSheet({ itemId, token: openings.current });
  }, []);
  const finished = useCallback((token: number) => setSheet((current) => (current?.token === token ? null : current)), []);
  const totals = stockTotals(items);
  const low = items.filter(isLow);
  useNavCount("stock", lowCounter(low.length));

  const matching = useMemo(() => items.filter((item) => matchesSearch(item, query)), [items, query]);
  const shown = filter === "low" ? matching.filter(isLow) : matching;
  const lowShown = shown.filter(isLow).sort(byName);
  const restShown = shown.filter((item) => !isLow(item)).sort(byName);
  const open = sheet ? (items.find((item) => item.id === sheet.itemId) ?? null) : null;

  if (items.length === 0) return <EmptyStock />;

  const summary = `${vialCount(totals.vials)} · ${money(totals.value)} at cost`;
  const filterOptions = [
    { value: "all" as const, label: <span data-testid="filter-all">All {items.length}</span> },
    { value: "low" as const, label: <span data-testid="filter-low">Low {low.length}</span> },
  ];

  return (
    <main className={BUSINESS_MAIN} data-testid="stock">
      {/* Phone nav bar (A3): back to Business, + records a purchase. */}
      <div className="flex h-11 items-center justify-between pr-3 pl-1.5 laptop:hidden">
        <Link href={BUSINESS_PATH} className="flex items-center gap-0.5 text-[17px] text-signal-ink">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Business
        </Link>
        <RecordButton kind="purchase" variant="soft" size="icon" aria-label="Record purchase">
          <Plus className="size-5" aria-hidden />
        </RecordButton>
      </div>

      <header className="px-5 pt-1 laptop:flex laptop:items-end laptop:gap-3 laptop:px-0 laptop:pt-0">
        <div className="flex flex-col-reverse laptop:flex-col">
          <div className="mt-1 font-mono text-[14px] font-medium text-ink-2 laptop:mt-0 laptop:text-[13px] laptop:text-ink-3" data-testid="stock-summary">
            {summary}
          </div>
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:mt-0.5">Stock</h1>
        </div>
        <div className="ml-auto hidden gap-3 laptop:flex">
          <RecordButton kind="purchase" variant="outline" size="sm" className="rounded-[12px] text-[14px]">
            Record purchase
          </RecordButton>
          <RecordButton kind="sale" variant="primary" size="sm" className="rounded-[12px] text-[14px]">
            Record sale
          </RecordButton>
        </div>
      </header>

      {/* The filter keeps its labels' width ("All 75 · Low 42"); the search takes the rest. */}
      <div className="mx-3 mt-3.5 grid grid-cols-[minmax(0,1fr)_max-content] gap-2 laptop:mx-0 laptop:mt-4 laptop:flex">
        <label className="flex h-11 items-center gap-2.5 rounded-[12px] bg-sunken px-3.5 text-ink-3 laptop:h-10 laptop:w-[300px]">
          <Search className="size-[18px] shrink-0 laptop:size-4" aria-hidden />
          <span className="sr-only">Search stock</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={`Search ${items.length} ${items.length === 1 ? "item" : "items"}`}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 laptop:text-[15px]"
          />
        </label>
        <Segmented<Filter>
          aria-label="Show"
          value={filter}
          onValueChange={setFilter}
          options={filterOptions}
          className="auto-cols-auto laptop:h-10 [&>*]:px-3.5"
        />
      </div>

      {shown.length === 0 ? (
        <p className="mx-5 mt-6 text-[15px] text-ink-2 laptop:mx-0" data-testid="stock-no-match">
          {filter === "low" && !query.trim() ? "Nothing is below its reorder level." : `No stock item matches “${query.trim()}”.`}
        </p>
      ) : null}

      {/* A3 phone: Low pinned first, then every other item. */}
      <div className="laptop:hidden">
        {lowShown.length > 0 ? (
          <section aria-label={`Low · ${lowShown.length}`}>
            <h2 className="mx-5 mt-5 mb-2 text-[13px] font-semibold text-low">Low · {lowShown.length}</h2>
            <div className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface">
              {lowShown.map((item) => (
                <StockRow key={item.id} item={item} onOpen={() => openSheet(item.id)} />
              ))}
            </div>
          </section>
        ) : null}
        {restShown.length > 0 ? (
          <section aria-label="All items">
            <h2 className="mx-5 mt-5 mb-2 text-[13px] font-semibold text-ink-2">All items</h2>
            <div className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface">
              {restShown.map((item) => (
                <StockRow key={item.id} item={item} onOpen={() => openSheet(item.id)} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {/* D4 laptop: the sortable table. */}
      {shown.length > 0 ? <StockTable items={shown} all={items} sort={sort} onSort={setSort} onOpen={openSheet} /> : null}

      <ThresholdSheet item={open} token={sheet?.token ?? 0} onClose={() => setSheet(null)} onDone={finished} />
    </main>
  );
}

function StockRow({ item, onOpen }: { item: StockLevel; onOpen: () => void }) {
  const low = isLow(item);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="stock-row"
      data-low={low || undefined}
      className={cn("flex h-[60px] w-full cursor-pointer items-center gap-3 px-4 text-left", low && "bg-low-tint")}
    >
      {low ? <StateGlyph state="low" /> : null}
      <span className="min-w-0 flex-1 truncate text-base font-semibold">
        {item.peptideName} <span className="font-mono text-[13px] font-normal text-ink-2">{item.strengthMg} mg</span>
        {low ? <span className="sr-only"> · low, reorder at {item.threshold}</span> : null}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[20px] leading-[1.1] font-semibold" data-testid="stock-count">
          {item.onHand.toLocaleString("en-CA")}
        </span>
        <span className={cn("block font-mono text-[12px]", low ? "text-low" : "text-ink-3")}>{money(item.valueAtCost)}</span>
      </span>
    </button>
  );
}

const COLUMNS: { key: StockSortKey; label: string; align: "left" | "right" }[] = [
  { key: "item", label: "Item", align: "left" },
  { key: "onHand", label: "On hand", align: "left" },
  { key: "value", label: "Value at cost", align: "right" },
  { key: "avgCost", label: "Avg cost", align: "right" },
  { key: "sold30d", label: "Sold 30 d", align: "right" },
];

function StockTable({
  items,
  all,
  sort,
  onSort,
  onOpen,
}: {
  items: StockLevel[];
  all: StockLevel[];
  sort: StockSort;
  onSort: (sort: StockSort) => void;
  onOpen: (id: string) => void;
}) {
  const rows = sortStock(items, sort);
  return (
    <div className="mt-4 hidden overflow-hidden rounded-group border border-line bg-surface laptop:block">
      <table className="w-full table-fixed text-[14px]" data-testid="stock-table">
        <colgroup>
          <col />
          <col className="w-[200px]" />
          <col className="w-[130px]" />
          <col className="w-[110px]" />
          <col className="w-[110px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-3">
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={column.key}
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("px-3 pt-3 pb-2 font-normal first:pl-5 last:pr-5", column.align === "right" ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSort({ key: column.key, direction: active && sort.direction === "asc" ? "desc" : active ? "asc" : column.key === "item" ? "asc" : "desc" })
                    }
                    className={cn("inline-flex cursor-pointer items-center gap-1 hover:text-ink", active && "font-semibold text-ink-2")}
                  >
                    {column.label}
                    {active ? <Arrow className="size-3" aria-hidden /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((item) => {
            const low = isLow(item);
            const average = avgCost(item);
            return (
              <tr key={item.id} className={cn(low && "bg-low-tint")} data-testid="stock-table-row" data-low={low || undefined}>
                <td className="py-2.5 pr-3 pl-5">
                  <button type="button" onClick={() => onOpen(item.id)} className="cursor-pointer truncate text-left font-semibold hover:underline">
                    {item.peptideName} <span className="font-mono text-[13px] font-normal text-ink-2">{item.strengthMg} mg</span>
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <b className="w-8 font-semibold">{item.onHand.toLocaleString("en-CA")}</b>
                    <span
                      role="meter"
                      aria-label={`${item.label} on hand`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(levelOf(item, all) * 100)}
                      className={cn("h-1.5 flex-1 overflow-hidden rounded-[3px]", low ? "bg-low-empty" : "bg-sunken")}
                    >
                      <i className={cn("block h-full", low ? "bg-low-fill" : "bg-ink")} style={{ width: `${levelOf(item, all) * 100}%` }} />
                    </span>
                    {low ? (
                      <span className="w-6 text-[12px] font-semibold text-low">Low</span>
                    ) : (
                      <span className="w-6" aria-hidden />
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">{money(item.valueAtCost)}</td>
                <td className="px-3 py-2.5 text-right text-ink-2">{average ? money(average) : "—"}</td>
                <td className="py-2.5 pr-5 pl-3 text-right text-ink-2">{item.sold30d.toLocaleString("en-CA")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A6a Stock · empty: stock items only exist once a purchase is recorded, so the only action is that. */
function EmptyStock() {
  return (
    <main className={BUSINESS_MAIN} data-testid="stock-empty">
      <div className="flex h-11 items-center pr-3 pl-1.5 laptop:hidden">
        <Link href={BUSINESS_PATH} className="flex items-center gap-0.5 text-[17px] text-signal-ink">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Business
        </Link>
      </div>
      <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
        <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">Stock</h1>
      </header>
      <EmptyStockPanel className="mx-3 mt-4 laptop:mx-0" />
    </main>
  );
}

/** A6a's block on its own (the screen above, and the component gallery). */
export function EmptyStockPanel({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-now border-[1.5px] border-dashed border-ink-3 px-5 pt-[22px] pb-5 laptop:max-w-[560px]", className)}>
      <div className="flex items-baseline gap-2 text-ink-3">
        <span className="text-[64px] leading-[0.85] font-semibold tracking-[-0.05em]">0</span>
        <span className="font-mono text-[17px]">vials</span>
      </div>
      <h2 className="mt-[18px] text-[22px] font-semibold tracking-[-0.015em]">No stock recorded yet</h2>
      <p className="mt-1.5 text-[15px] leading-[1.45] text-ink-2">
        Record a purchase to add the first peptide and vial strength. Sales can be recorded once there&apos;s stock.
      </p>
      <RecordButton kind="purchase" variant="ink" size="lg" className="mt-[18px] w-full text-base">
        Record a purchase
      </RecordButton>
    </section>
  );
}

const THRESHOLD_FAILED = "Couldn't save. Your entry is still here.";

/** An item's sheet: its figures and its reorder level (the per-item low-stock threshold). */
function ThresholdSheet({
  item,
  token,
  onClose,
  onDone,
}: {
  item: StockLevel | null;
  /** This opening (each opening is a fresh sheet, even for the same item). */
  token: number;
  onClose: () => void;
  /** A submission made in opening `token` finished (saved or replayed). */
  onDone: (token: number) => void;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      {item ? <ThresholdContent key={token} item={item} token={token} onDone={onDone} /> : null}
    </Sheet>
  );
}

function ThresholdContent({ item, token, onDone }: { item: StockLevel; token: number; onDone: (token: number) => void }) {
  const router = useRouter();
  const toast = useAlphaToast();
  const [text, setText] = useState(String(item.threshold));
  // The level every Save compares against (compare-and-set in the database):
  // the one this sheet was opened with, or the one a refusal then showed.
  // Never taken from a refresh the admin hasn't seen.
  const [expected, setExpected] = useState(item.threshold);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The submission still waiting for a sure answer in this opening: Retry and
  // Save with the same value reuse its request key (a replay if it was saved).
  const pending = useRef<ThresholdAttempt | null>(null);
  const average = avgCost(item);
  // A Retry from a toast can answer after this sheet has closed.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = async (attempt: ThresholdAttempt) => {
    // It may have been saved: Retry sends the same attempt (the same request key).
    const unsure = () =>
      toast.error({ message: THRESHOLD_FAILED, action: { label: "Retry", onAction: () => void send(attempt) } });
    setSaving(true);
    try {
      const result = await setStockThresholdAction({
        requestKey: attempt.key,
        stockItemId: item.id,
        expected: attempt.expected,
        threshold: attempt.value,
      });
      // Saved, replayed or refused: the next submission is a new edit. An
      // unsure answer keeps the attempt (lib/business/stock.ts settles).
      if (settles(result) && pending.current === attempt) pending.current = null;
      if (result.unsure) {
        unsure();
        return;
      }
      if (result.error) {
        // Changed since it was shown: the sheet stays open with the entry, and
        // the next Save is a decision over the level the message names.
        const current = result.changed?.threshold;
        if (current !== undefined && current !== null) setExpected(current);
        if (mounted.current) setError(result.error);
        else toast.error({ message: `${item.label}: ${result.error}` });
        return;
      }
      toast.success({
        message: result.replayed
          ? `${item.label}: this change was already saved. The list shows the current level.`
          : `${item.label}: reorder at ${vialCount(result.threshold ?? attempt.value)}`,
      });
      router.refresh();
      onDone(token);
    } catch {
      // No answer at all (the connection dropped).
      unsure();
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const save = () => {
    // Offline, a save waits for the connection (the button is disabled; this covers Enter and keyboard submits).
    if (!isOnline()) return;
    const parsed = parseThreshold(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const attempt = attemptFor(pending.current, parsed.value, expected, () => crypto.randomUUID());
    pending.current = attempt;
    void send(attempt);
  };

  return (
    <SheetContent
      title={item.label}
      context={`${vialCount(item.onHand)} on hand · ${money(item.valueAtCost)} at cost`}
      size="auto"
      footer={
        <>
          <Link
            href={`/admin/inventory/${item.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "px-4 text-[15px] laptop:h-12")}
          >
            Purchases and sales
          </Link>
          <Button needsConnection size="lg" className="laptop:h-12" saving={saving} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <dl className="mx-2 grid grid-cols-3 gap-3 text-[13px]" data-testid="stock-sheet-figures">
        <div>
          <dt className="text-ink-3">Avg cost</dt>
          <dd className="mt-0.5 text-[17px] font-semibold">{average ? money(average) : "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Sold 30 d</dt>
          <dd className="mt-0.5 text-[17px] font-semibold">{item.sold30d.toLocaleString("en-CA")}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Status</dt>
          <dd className={cn("mt-0.5 text-[17px] font-semibold", isLow(item) && "text-low")}>
            {isLow(item) ? <Tag tone="low">Low</Tag> : "In stock"}
          </dd>
        </div>
      </dl>
      <form
        className="mx-2 mt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label="Reorder at"
          description="Low when fewer vials than this are on hand. 0 never flags this item."
          error={error}
        >
          <NumberInput
            name="threshold"
            inputMode="numeric"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            unit="vials"
          />
        </Field>
        <p className="mt-2 font-mono text-[12px] text-ink-3" data-testid="threshold-changed">
          {item.thresholdChangedAt
            ? `Set by ${item.thresholdChangedBy ?? "an admin"} · ${new Date(item.thresholdChangedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" })}`
            : "Default reorder level, never changed"}
        </p>
        <button type="submit" hidden />
      </form>
    </SheetContent>
  );
}
