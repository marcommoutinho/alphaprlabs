import { notFound } from "next/navigation";
import { TemplateEditor } from "@/components/admin/library/template-editor";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getTemplate, listTemplatePeptides } from "@/lib/templates/service";

export const metadata = { title: "Edit template · Alpha PR Labs" };

type Params = Promise<{ templateId: string }>;

/**
 * D7 Edit template. Keyed by the template's version: after a save (or "Load
 * latest" when another admin saved first) it reopens on what is stored.
 */
export default async function TemplateEditorPage({ params }: { params: Params }) {
  const { templateId } = await params;
  await requireAdmin(`/admin/library/templates/${encodeURIComponent(templateId)}`);
  const db = await createClient();
  const [template, peptides] = await Promise.all([getTemplate(db, templateId), listTemplatePeptides(db)]);
  if (!template) notFound();
  return <TemplateEditor key={`${template.id}:${template.version}`} template={template} peptides={peptides} />;
}
