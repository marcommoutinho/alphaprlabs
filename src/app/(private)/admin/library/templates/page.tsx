import { LibraryHeader } from "@/components/admin/library/library-header";
import { TemplateList } from "@/components/admin/library/template-list";
import { BUSINESS_MAIN } from "@/components/business/frame";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listTemplatePeptides, listTemplates } from "@/lib/templates/service";

export const metadata = { title: "Templates · Alpha PR Labs" };

/**
 * A10 Library · Templates (admins only; researchers read templates on their
 * side, write nothing). The old /admin/templates redirects here.
 */
export default async function TemplatesPage() {
  await requireAdmin("/admin/library/templates");
  const db = await createClient();
  const [templates, peptides] = await Promise.all([listTemplates(db), listTemplatePeptides(db)]);
  return (
    <main className={BUSINESS_MAIN} data-testid="templates">
      <LibraryHeader tab="templates" counts={{ peptides: peptides.length, templates: templates.length }} />
      <TemplateList templates={templates} peptides={peptides} />
    </main>
  );
}
