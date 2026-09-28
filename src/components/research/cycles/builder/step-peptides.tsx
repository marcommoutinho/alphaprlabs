"use client";

import Link from "@/components/alpha/link";
import { Check, ChevronRight, Layers, Search } from "lucide-react";
import { useState } from "react";
import { Tag } from "@/components/alpha/tag";
import type { CyclePeptide } from "@/lib/cycles/rules";
import { cn } from "@/lib/utils";

export type PeptideChoice = {
  peptide: CyclePeptide;
  /** Started while editing: can't be removed (end its phases instead). */
  locked: boolean;
};

/**
 * R4a Choose peptides: the template row (the fast path), a search, the
 * selection pinned on top and every peptide still offered below. Peptides
 * not offered are hidden, except one this cycle (or its template) already
 * has: it stays selected and can be taken out, not added back.
 */
export function StepPeptides({
  selected,
  library,
  templates,
  templateNote,
  onToggle,
}: {
  selected: readonly PeptideChoice[];
  /** Everything the caller may read; only available ones are offered. */
  library: readonly CyclePeptide[];
  /** "Recovery stack, GLP-1 starter and 4 more", or null to leave the row out. */
  templates: string | null;
  /** A template copy's note, instead of the row. */
  templateNote: string | null;
  onToggle: (peptide: CyclePeptide) => void;
}) {
  const [query, setQuery] = useState("");
  const offered = library.filter((peptide) => peptide.available);
  const chosen = new Set(selected.map((choice) => choice.peptide.id));
  const q = query.trim().toLowerCase();
  const rest = offered.filter((peptide) => !chosen.has(peptide.id) && (!q || peptide.name.toLowerCase().includes(q)));

  return (
    <>
      <div className="px-5 pt-[22px] laptop:px-0">
        <h1 className="text-[30px] leading-[1.15] font-semibold tracking-[-0.025em]">Choose peptides</h1>
        <p className="mt-1.5 text-[15px] leading-[1.45] text-ink-2">Pick one or more. Dose, mix and schedule come next, one peptide at a time.</p>
      </div>

      {templateNote ? (
        <p className="mx-3 mt-[18px] rounded-[16px] bg-sunken px-4 py-3 text-[14px] leading-5 text-ink-2 laptop:mx-0" data-testid="template-note">
          {templateNote}
        </p>
      ) : templates ? (
        <Link href="/app/cycles/templates" className="mx-3 mt-[18px] flex items-center gap-3 rounded-group border border-line bg-surface px-3.5 py-3 laptop:mx-0">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-sunken">
            <Layers className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">Start from a template</span>
            <span className="mt-px block truncate text-[13px] text-ink-2">{templates}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
        </Link>
      ) : null}

      <label className="mx-3 mt-3 flex h-12 items-center gap-2.5 rounded-[14px] bg-sunken px-3.5 text-ink-3 laptop:mx-0">
        <Search className="size-[18px] shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${offered.length} peptides`}
          aria-label="Search peptides"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
        />
      </label>

      {selected.length ? (
        <section aria-label="Selected peptides" className="mt-[18px]">
          <h2 className="mb-2 px-5 text-[13px] font-semibold text-ink-2 laptop:px-0">Selected · {selected.length}</h2>
          <ul className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:mx-0" data-testid="selected-peptides">
            {selected.map(({ peptide, locked }) => (
              <PeptideRow key={peptide.id} peptide={peptide} checked disabled={locked} note={locked ? "Started · end its phases instead" : null} onToggle={() => onToggle(peptide)} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="All peptides" className="mt-[18px]">
        <h2 className="mb-2 px-5 text-[13px] font-semibold text-ink-2 laptop:px-0">All peptides</h2>
        {rest.length ? (
          <ul className="mx-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface laptop:mx-0" data-testid="all-peptides">
            {rest.map((peptide) => (
              <PeptideRow key={peptide.id} peptide={peptide} checked={false} onToggle={() => onToggle(peptide)} />
            ))}
          </ul>
        ) : (
          <p className="px-5 text-[15px] text-ink-2 laptop:px-0">{q ? `No peptides match “${query.trim()}”.` : "Every peptide on offer is selected."}</p>
        )}
      </section>
    </>
  );
}

function PeptideRow({
  peptide,
  checked,
  disabled = false,
  note = null,
  onToggle,
}: {
  peptide: CyclePeptide;
  checked: boolean;
  disabled?: boolean;
  note?: string | null;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onToggle();
        }}
        className={cn("flex min-h-[58px] w-full items-center gap-3 px-4 py-2 text-left", disabled && "cursor-default")}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-base font-semibold">
            <span className="truncate">{peptide.name}</span>
            {!peptide.available ? <Tag tone="outline">Not offered</Tag> : null}
          </span>
          {note ? <span className="mt-0.5 block text-[13px] text-ink-3">{note}</span> : null}
        </span>
        <span
          aria-hidden
          className={cn(
            "flex size-[26px] shrink-0 items-center justify-center rounded-[8px]",
            checked ? "bg-ink text-surface" : "border-[1.5px] border-ink-3",
            disabled && "opacity-40",
          )}
        >
          {checked ? <Check className="size-4" strokeWidth={3} /> : null}
        </span>
      </button>
    </li>
  );
}
