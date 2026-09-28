"use client";

import Link from "@/components/alpha/link";
import { useState } from "react";
import { NO_PEPTIDES, NO_TEMPLATES, NO_TEMPLATES_MATCH, noPeptidesMatch } from "@/lib/library/research-view";

export type LibraryTemplateCard = {
  id: string;
  name: string;
  days: number;
  summary: string;
  warning: string;
  /** Lower-case text the search matches: the name and the peptides it names. */
  search: string[];
};

export type LibraryPeptideRow = { id: string; name: string; sub: string };

/** R6 Library: the search box filters templates (by name or peptide) and peptides (by name) as you type. */
export function LibraryBrowser({ templates, peptides }: { templates: LibraryTemplateCard[]; peptides: LibraryPeptideRow[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shownTemplates = templates.filter((t) => !q || t.search.some((text) => text.includes(q)));
  const shownPeptides = peptides.filter((p) => !q || p.name.toLowerCase().includes(q));

  return (
    <>
      <input
        className="app-rl-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search peptides and templates"
        aria-label="Search library"
      />

      <h2 className="app-cv-group app-rl-group">Templates</h2>
      {shownTemplates.length === 0 ? <p className="app-rl-empty">{templates.length === 0 ? NO_TEMPLATES : NO_TEMPLATES_MATCH}</p> : null}
      <div className="app-rl-templates">
        {shownTemplates.map((t) => (
          <Link key={t.id} href={`/app/library/templates/${t.id}`} className="app-rl-template" data-testid="library-template">
            <span className="app-rl-template-head">
              <b>{t.name}</b>
              <span>{t.days} days</span>
            </span>
            <span className="app-rl-template-summary">{t.summary}</span>
            {t.warning ? <span className="app-rl-template-warning">{t.warning}</span> : null}
          </Link>
        ))}
      </div>

      <h2 className="app-cv-group app-rl-group app-rl-group--peptides">Peptides</h2>
      {shownPeptides.length === 0 ? <p className="app-rl-empty">{peptides.length === 0 ? NO_PEPTIDES : noPeptidesMatch(query.trim())}</p> : null}
      <div className="app-rl-peptides">
        {shownPeptides.map((p) => (
          <Link key={p.id} href={`/app/library/peptides/${p.id}`} className="app-rl-peptide" data-testid="library-peptide">
            <span>
              <span className="app-rl-peptide-name">{p.name}</span>
              <span className="app-rl-peptide-sub">{p.sub}</span>
            </span>
            <span className="app-rl-peptide-badge">Available</span>
          </Link>
        ))}
      </div>
    </>
  );
}
