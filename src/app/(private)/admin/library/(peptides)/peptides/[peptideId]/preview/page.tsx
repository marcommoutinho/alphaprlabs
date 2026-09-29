import { ChevronLeft, Eye } from "lucide-react";
import { notFound } from "next/navigation";
import { peptidePath } from "@/components/admin/library/library-header";
import Link from "@/components/alpha/link";
import { Tag } from "@/components/alpha/tag";
import { PeptideSections } from "@/components/research/library/peptide-sections";
import { requireAdmin } from "@/lib/auth/session";
import { peptideState } from "@/lib/library/admin";
import { updatedLabel } from "@/lib/library/screen";
import { adminPeptide } from "@/lib/library/service";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Preview · Alpha PR Labs" };

type Params = Promise<{ peptideId: string }>;

const PREVIEW_NOTE = {
  offered: "Researchers see this on the peptide page.",
  draft: "A draft: researchers can't see it until it's published.",
  "not-offered": "Not offered: only researchers whose cycles use it can open it.",
} as const;

/**
 * D6 "Preview as researcher": the stored entry exactly as R12 shows it (the
 * same sections), read through the admin's function so a draft can be
 * previewed. Saved content only: unsaved edits aren't shown.
 */
export default async function PeptidePreviewPage({ params }: { params: Params }) {
  const { peptideId } = await params;
  await requireAdmin(`/admin/library/peptides/${encodeURIComponent(peptideId)}/preview`);
  const entry = await adminPeptide(await createClient(), peptideId);
  if (!entry) notFound();
  const state = peptideState(entry);
  const back = peptidePath(entry.id);

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-paper pt-[env(safe-area-inset-top)] pb-10 laptop:sticky laptop:top-0 laptop:z-auto laptop:h-dvh laptop:pt-0"
      data-testid="peptide-preview-pane"
    >
      <nav aria-label="Preview" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link href={back} className="flex h-11 items-center gap-0.5">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Edit
        </Link>
      </nav>
      <div className="laptop:max-w-[760px] laptop:px-8 laptop:pt-6">
        <Link href={back} className="hidden text-[14px] text-signal-ink laptop:block">
          ‹ Back to editing
        </Link>
        <div className="mx-3 mt-1 flex items-start gap-2.5 rounded-now bg-sunken px-4 py-3 text-[14px] text-ink-2 laptop:mx-0 laptop:mt-3" data-testid="preview-banner">
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold text-ink">Preview as researcher.</span> {PREVIEW_NOTE[state]}
          </span>
        </div>
        <header className="mt-4 px-5 laptop:px-0">
          <div className="font-mono text-[13px] font-medium text-ink-3">{updatedLabel(entry.updatedAt)}</div>
          {/* The pane sits beside the list's "Library" title, like the editor: a second-level heading. */}
          <h2 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em] break-words">{entry.name}</h2>
          {state === "not-offered" ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
              <Tag tone="outline">Not offered</Tag>
              No longer in the library. It stays in the cycles that use it.
            </p>
          ) : null}
        </header>
        <PeptideSections peptide={entry} preview />
      </div>
    </div>
  );
}
