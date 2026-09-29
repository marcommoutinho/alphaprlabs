"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import Link from "@/components/alpha/link";
import { Tag } from "@/components/alpha/tag";
import { type AdminPeptide, byPeptideName, matchesPeptide, peptideState, rowMeta, rowMetaShort, STATE_LABEL } from "@/lib/library/admin";
import { cn } from "@/lib/utils";
import { peptidePath } from "./library-header";

/**
 * A8 / D6 list: every entry by name with "Updated Aug 20 · in 4 cycles" (a
 * count only, never whose cycles) and its state: Offered, a Draft tag, or a
 * Not offered outline tag with the name in ink-2. Search matches the name
 * and short description. On a laptop the open entry is the selected row.
 */
export function PeptideList({ entries }: { entries: AdminPeptide[] }) {
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const sorted = useMemo(() => [...entries].sort(byPeptideName), [entries]);
  const shown = sorted.filter((entry) => matchesPeptide(entry, query));

  if (!entries.length) {
    return (
      <div className="mx-3 mt-4 rounded-group border border-line bg-surface px-5 py-6 laptop:mx-2.5" data-testid="library-empty">
        <p className="text-[17px] font-semibold">No peptides yet</p>
        <p className="mt-1 text-[15px] text-ink-2">Add one, fill in its research summary and publish it when researchers should see it.</p>
      </div>
    );
  }

  return (
    <>
      <label className="mx-3 mt-3.5 flex h-11 items-center gap-2.5 rounded-[12px] bg-sunken px-3.5 text-ink-3 laptop:mx-5 laptop:mt-0 laptop:h-[38px] laptop:rounded-[10px] laptop:px-3">
        <Search className="size-[18px] shrink-0 laptop:size-[15px]" aria-hidden />
        <span className="sr-only">Search peptides</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 laptop:text-[14px]"
        />
      </label>
      {shown.length === 0 ? (
        <p className="mx-5 mt-5 text-[15px] text-ink-2" data-testid="library-no-match">
          No peptide matches “{query.trim()}”.
        </p>
      ) : (
        <ul
          aria-label="Peptides"
          className="mx-3 mt-4 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:mx-2.5 laptop:mt-3 laptop:flex laptop:flex-col laptop:gap-0.5 laptop:divide-y-0 laptop:overflow-visible laptop:rounded-none laptop:border-0 laptop:bg-transparent"
        >
          {shown.map((entry) => (
            <li key={entry.id}>
              <PeptideRow entry={entry} selected={pathname === peptidePath(entry.id) || pathname.startsWith(`${peptidePath(entry.id)}/`)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PeptideRow({ entry, selected }: { entry: AdminPeptide; selected: boolean }) {
  const state = peptideState(entry);
  return (
    <Link
      href={peptidePath(entry.id)}
      aria-current={selected ? "page" : undefined}
      data-testid="library-row"
      data-state={state}
      className={cn(
        "flex items-center gap-2.5 py-3 pr-3 pl-4",
        "laptop:rounded-[12px] laptop:border laptop:border-transparent laptop:px-3 laptop:py-2.5",
        "laptop:aria-[current=page]:border-line laptop:aria-[current=page]:bg-surface",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-base font-semibold laptop:text-[15px]", state === "not-offered" && "text-ink-2")}>{entry.name}</span>
        <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-3 laptop:mt-0">
          <span className="laptop:hidden">{rowMeta(entry)}</span>
          <span className="hidden laptop:inline">{rowMetaShort(entry)}</span>
        </span>
      </span>
      {state === "offered" ? (
        <span className="text-[13px] text-ink-2">{STATE_LABEL.offered}</span>
      ) : (
        <Tag tone={state === "draft" ? "low" : "outline"} className="laptop:text-[12px]">
          {STATE_LABEL[state]}
        </Tag>
      )}
      <ChevronRight className="size-[18px] shrink-0 text-ink-3 laptop:hidden" aria-hidden />
    </Link>
  );
}
