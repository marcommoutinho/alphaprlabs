"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import Link from "@/components/alpha/link";
import { Group } from "@/components/alpha/list";
import { Tag } from "@/components/alpha/tag";
import { filterRows, IN_YOUR_CYCLE, LIBRARY_EMPTY, LIBRARY_EMPTY_BODY, type LibraryFilter, type LibraryRow, noMatch, NOT_IN_CYCLES } from "@/lib/library/screen";
import { cn } from "@/lib/utils";
import { CYCLES_MAIN } from "../cycles/cycles-list";

export const LIBRARY_MAIN = CYCLES_MAIN;

/**
 * R11 Library (researchers): the count and last update, search, the All ·
 * In my cycles chips and one row per peptide still offered, tagged "In your
 * cycle" when a current cycle uses it. On a laptop the list keeps a reading
 * width.
 */
export function LibraryScreen({ meta, rows }: { meta: string; rows: LibraryRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const mine = rows.filter((row) => row.inCycle).length;
  const shown = filterRows(rows, filter, query);
  const chips: { value: LibraryFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "mine", label: `In my cycles · ${mine}` },
  ];

  return (
    <main className={LIBRARY_MAIN}>
      <div className="laptop:max-w-[760px]">
        <header className="px-5 pt-2 laptop:px-0 laptop:pt-0">
          <div className="font-mono text-[13px] font-medium text-ink-3" data-testid="library-meta">
            {meta}
          </div>
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Library</h1>
        </header>
        {rows.length === 0 ? (
          <section className="mx-3 mt-5 rounded-group border border-dashed border-ink-3 px-5 py-6 laptop:mx-0" data-testid="library-empty">
            <h2 className="text-[17px] font-semibold">{LIBRARY_EMPTY}</h2>
            <p className="mt-1 text-[15px] leading-[22px] text-ink-2">{LIBRARY_EMPTY_BODY}</p>
          </section>
        ) : (
          <>
            <label className="mx-3 mt-3.5 flex h-11 items-center gap-2.5 rounded-[12px] bg-sunken px-3.5 text-ink-3 focus-within:ring-2 focus-within:ring-signal laptop:mx-0">
              <Search className="size-[18px] shrink-0" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search peptides"
                aria-label="Search peptides"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="-mr-1.5 grid size-8 place-items-center rounded-full text-ink-3">
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </label>
            <div role="group" aria-label="Show" className="mx-3 mt-3 flex flex-wrap gap-1.5 laptop:mx-0">
              {chips.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={filter === chip.value}
                  onClick={() => setFilter(chip.value)}
                  data-testid={`library-filter-${chip.value}`}
                  className={cn(
                    "flex h-9 items-center rounded-[10px] border px-3 text-[14px] transition-colors",
                    filter === chip.value ? "border-ink bg-ink font-semibold text-surface" : "border-line bg-surface text-ink",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            {shown.length ? (
              <Group className="mx-3 mt-3.5 laptop:mx-0" data-testid="library-list">
                {shown.map((row) => (
                  <Link
                    key={row.id}
                    href={`/app/library/peptides/${row.id}`}
                    className="flex items-center gap-2.5 py-3 pr-3 pl-4 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]"
                    data-testid="library-peptide"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-base font-semibold">
                        <span className="truncate">{row.name}</span>
                        {row.inCycle ? (
                          <Tag tone="now" data-testid="in-your-cycle">
                            {IN_YOUR_CYCLE}
                          </Tag>
                        ) : null}
                      </span>
                      {row.description ? <span className="mt-0.5 block truncate text-[13px] text-ink-2">{row.description}</span> : null}
                    </span>
                    <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
                  </Link>
                ))}
              </Group>
            ) : (
              <p className="mx-5 mt-5 text-[15px] text-ink-2 laptop:mx-0" role="status">
                {query.trim() ? noMatch(query.trim()) : NOT_IN_CYCLES}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
