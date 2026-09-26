import { AppPage } from "@/components/app-shell/app-shell";
import { LibraryBrowser } from "@/components/research/library-browser";
import { requireResearcher } from "@/lib/auth/session";
import { listCyclePeptides } from "@/lib/cycles/service";
import { listAvailablePeptides, listResearchTemplates } from "@/lib/library/research";
import {
  includesWithdrawn,
  LIBRARY_INTRO,
  peptideSub,
  TEMPLATE_CARD_WARNING,
  templateDays,
  templateSearchText,
  templateSummary,
} from "@/lib/library/research-view";
import { createClient } from "@/lib/supabase/server";
import "@/styles/app/cycle-views.css";
import "@/styles/app/research-library.css";

/**
 * R6 Library: supplied templates and the peptides still offered (entries
 * marked "Not offered" never appear here; Marco, 2026-09-26). A template
 * that names a withdrawn peptide is listed, with its warning, and names it.
 */
export default async function LibraryPage() {
  await requireResearcher("/app/library");
  const db = await createClient();
  // Names for the templates: every entry the caller can read (available ones,
  // and withdrawn ones their own cycles use); the list shows available ones only.
  const [peptides, readable] = await Promise.all([listAvailablePeptides(db), listCyclePeptides(db)]);
  const templates = await listResearchTemplates(db, new Map(readable.map((peptide) => [peptide.id, peptide])));

  const cards = templates.map((template) => {
    const names = new Map(template.peptides.map((peptide) => [peptide.id, peptide]));
    return {
      id: template.id,
      name: template.name,
      days: templateDays(template),
      summary: templateSummary(template, names),
      warning: includesWithdrawn(template, names) ? TEMPLATE_CARD_WARNING : "",
      search: templateSearchText(template, names),
    };
  });
  const rows = peptides.map((peptide) => ({ id: peptide.id, name: peptide.name, sub: peptideSub(peptide) }));

  return (
    <AppPage>
      <h1 className="app-h1">Library</h1>
      <p className="app-rl-intro">{LIBRARY_INTRO}</p>
      <LibraryBrowser templates={cards} peptides={rows} />
    </AppPage>
  );
}
