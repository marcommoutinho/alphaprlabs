import { TemplateEditor } from "@/components/admin/library/template-editor";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listTemplatePeptides } from "@/lib/templates/service";

export const metadata = { title: "New template · Alpha PR Labs" };

/** D7 Add template: offered peptides only can be added. */
export default async function NewTemplatePage() {
  await requireAdmin("/admin/library/templates/new");
  const peptides = await listTemplatePeptides(await createClient());
  return <TemplateEditor template={null} peptides={peptides} />;
}
