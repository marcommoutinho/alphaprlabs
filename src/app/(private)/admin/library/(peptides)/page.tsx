import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Library · Alpha PR Labs" };

/** D6 with no entry open: the editor pane asks for one (phones show the list alone). */
export default async function LibraryPage() {
  await requireAdmin("/admin/library");
  return (
    <div className="hidden h-dvh flex-col items-center justify-center gap-1 px-8 text-center laptop:sticky laptop:top-0 laptop:flex" data-testid="library-idle">
      <p className="text-[17px] font-semibold">Choose a peptide</p>
      <p className="max-w-[340px] text-[15px] text-ink-2">Edit its content and whether it&apos;s offered, or add a new one. A draft stays hidden from researchers until it&apos;s published.</p>
    </div>
  );
}
