import Link from "@/components/alpha/link";
import { Tag } from "@/components/alpha/tag";
import { CardLane } from "@/components/research/cycles/lanes";
import { STATE_LABEL } from "@/lib/library/admin";
import { templateLanes, templateLength, usageLine, withdrawnLine } from "@/lib/templates/display";
import type { TemplatePeptide, TemplateRecord } from "@/lib/templates/rules";
import { cn } from "@/lib/utils";
import { NEW_TEMPLATE_PATH, templatePath } from "./library-header";

/**
 * A10 Templates: a card per template with its length, a mini lane per
 * peptide (bar height follows the dose, breaks hatched) and how many cycles
 * started from it. A draft carries the library's Draft tag: researchers
 * don't see it until it is published. A template that names a peptide no longer offered says so
 * in `low`; it can still be opened, edited and used (Marco, 2026-09-26).
 */
export function TemplateList({ templates, peptides }: { templates: TemplateRecord[]; peptides: TemplatePeptide[] }) {
  const byId = new Map(peptides.map((peptide) => [peptide.id, peptide]));
  if (!templates.length) {
    return (
      <div className="mx-3 mt-4 rounded-group border border-line bg-surface px-5 py-6 laptop:mx-0 laptop:max-w-[560px]" data-testid="templates-empty">
        <p className="text-[17px] font-semibold">No templates yet</p>
        <p className="mt-1 text-[15px] text-ink-2">A template is a starting point researchers copy into their own cycle and adjust.</p>
        <Link href={NEW_TEMPLATE_PATH} className="mt-3 inline-block text-[15px] font-semibold text-signal-ink">
          Add a template
        </Link>
      </div>
    );
  }
  const sorted = [...templates].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
  return (
    <ul aria-label="Templates" className="mx-3 mt-4 grid grid-cols-1 gap-2.5 laptop:mx-0 laptop:grid-cols-2 laptop:gap-3 xl:grid-cols-3">
      {sorted.map((template) => {
        const { lanes } = templateLanes(template);
        const withdrawn = withdrawnLine(template, byId);
        return (
          <li key={template.id}>
            <Link
              href={templatePath(template.id)}
              className="block h-full rounded-group border border-line bg-surface px-4 py-3.5"
              data-testid="template-card"
              data-withdrawn={withdrawn ? "" : undefined}
              data-state={template.publishedAt === null ? "draft" : "published"}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-[17px] font-semibold">{template.name}</span>
                  {template.publishedAt === null ? (
                    <Tag tone="low" data-testid="template-draft">
                      {STATE_LABEL.draft}
                    </Tag>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[12px] font-medium text-ink-3">{templateLength(template)}</span>
              </span>
              <span className="mt-3 grid grid-cols-[70px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 font-mono text-[12px] font-medium text-ink-2">
                {lanes.map((lane, i) => {
                  const peptide = byId.get(lane.peptideId);
                  const offered = peptide?.available === true;
                  return (
                    <span key={`${lane.peptideId}-${i}`} className="contents">
                      <span className={cn("truncate", !offered && "text-ink-3")}>{peptide?.name ?? "Unknown"}</span>
                      {offered ? (
                        <CardLane bars={lane.bars} todayPercent={null} height={16} />
                      ) : (
                        <span aria-hidden className="h-2 rounded-[2px] border border-dashed border-ink-3" />
                      )}
                    </span>
                  );
                })}
              </span>
              <span className="mt-2.5 block text-[13px] text-ink-3" data-testid="template-usage">
                {usageLine(template)}
              </span>
              {withdrawn ? (
                <span className="mt-1 block text-[13px] font-semibold text-low" data-testid="template-withdrawn">
                  {withdrawn}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
