import { AppPage } from "@/components/app-shell/app-shell";
import { TemplatesView } from "@/components/admin/templates-view";
import { requireAdmin } from "@/lib/auth/session";
import { listTemplatePeptides, listTemplates } from "@/lib/templates/service";
import { createClient } from "@/lib/supabase/server";

/** A3 Cycle templates (admins only; RLS and the database functions also check). */
export default async function TemplatesPage() {
  await requireAdmin("/admin/templates");
  const db = await createClient();
  const [templates, peptides] = await Promise.all([listTemplates(db), listTemplatePeptides(db)]);
  return (
    <AppPage>
      <TemplatesView templates={templates} peptides={peptides} />
    </AppPage>
  );
}
