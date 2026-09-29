import { ChevronLeft, Plus } from "lucide-react";
import { buttonVariants } from "@/components/alpha/button-variants";
import Link from "@/components/alpha/link";
import { SegmentedLinks } from "@/components/alpha/segmented";
import { BUSINESS_PATH } from "@/components/business/frame";
import { cn } from "@/lib/utils";

export const LIBRARY_PATH = "/admin/library";
export const TEMPLATES_PATH = "/admin/library/templates";
export const NEW_PEPTIDE_PATH = "/admin/library/peptides/new";
export const NEW_TEMPLATE_PATH = "/admin/library/templates/new";
export const peptidePath = (id: string) => `/admin/library/peptides/${id}`;
export const templatePath = (id: string) => `/admin/library/templates/${id}`;

export type LibraryTab = "peptides" | "templates";

/**
 * A8 / D6 top: the phone's "‹ Business" bar with the round +, the title,
 * then Peptides · N | Templates · M. `pane` is D6's 360 px list column
 * (28 px title, "Add peptide" 36 px, 38 px control); otherwise the page
 * width (A10 on a laptop).
 */
export function LibraryHeader({
  tab,
  counts,
  pane = false,
  children,
}: {
  tab: LibraryTab;
  counts: { peptides: number; templates: number };
  pane?: boolean;
  children?: React.ReactNode;
}) {
  const add = tab === "peptides" ? { href: NEW_PEPTIDE_PATH, label: "Add peptide" } : { href: NEW_TEMPLATE_PATH, label: "Add template" };
  return (
    <>
      <div className="flex h-11 items-center justify-between pr-3 pl-1.5 laptop:hidden">
        <Link href={BUSINESS_PATH} className="flex items-center gap-0.5 text-[17px] text-signal-ink">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Business
        </Link>
        <Link href={add.href} aria-label={add.label} className={buttonVariants({ variant: "soft", size: "icon" })} data-testid="library-add">
          <Plus className="size-5" aria-hidden />
        </Link>
      </div>
      <header className={cn("flex flex-col px-5 pt-1", pane ? "laptop:gap-3 laptop:px-5 laptop:pt-6 laptop:pb-3" : "laptop:px-0 laptop:pt-0")}>
        <div className="flex items-center justify-between gap-3">
          <h1 className={cn("text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]", pane && "laptop:text-[28px] laptop:tracking-[-0.025em]")}>Library</h1>
          <Link
            href={add.href}
            className={cn(buttonVariants({ variant: "ink", size: "sm" }), "hidden h-9 rounded-[10px] px-3 text-[14px] laptop:inline-flex")}
            data-testid="library-add-laptop"
          >
            {add.label}
          </Link>
        </div>
        <SegmentedLinks
          label="Library"
          current={tab}
          links={[
            { key: "peptides", label: `Peptides · ${counts.peptides}`, href: LIBRARY_PATH },
            { key: "templates", label: `Templates · ${counts.templates}`, href: TEMPLATES_PATH },
          ]}
          className={cn("mt-3.5", pane ? "laptop:mt-0 laptop:h-[38px] laptop:rounded-[10px] laptop:[&>a]:rounded-[8px] laptop:[&>a]:text-[14px]" : "laptop:mt-4 laptop:h-10 laptop:max-w-[360px]")}
        />
        {children}
      </header>
    </>
  );
}
