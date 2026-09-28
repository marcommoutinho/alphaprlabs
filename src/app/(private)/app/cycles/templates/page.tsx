import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Group } from "@/components/alpha/list";
import { Tag } from "@/components/alpha/tag";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";
import { requireResearcher } from "@/lib/auth/session";
import { listCyclePeptides } from "@/lib/cycles/service";
import { listResearchTemplates } from "@/lib/library/research";
import { includesWithdrawn, NO_TEMPLATES, TEMPLATE_CARD_WARNING, templateDays } from "@/lib/library/research-view";
import { createClient } from "@/lib/supabase/server";

/**
 * R10's "Browse templates" and R4a's "Start from a template": the supplied
 * templates, each opening the builder prefilled with its copy
 * (/app/cycles/new?template=…). A template naming a peptide no longer offered
 * is listed and can still be used; the copy keeps that peptide (Marco,
 * 2026-09-26). The full template pages stay in the Library.
 */
export default async function CycleTemplatesPage() {
  await requireResearcher("/app/cycles/templates");
  const db = await createClient();
  const readable = await listCyclePeptides(db);
  const templates = await listResearchTemplates(db, new Map(readable.map((peptide) => [peptide.id, peptide])));

  return (
    <main className={CYCLES_MAIN}>
      <nav aria-label="Templates" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
        <Link prefetch={false} href="/app/cycles" className="flex h-11 items-center gap-0.5">
          <ChevronLeft className="size-[26px]" aria-hidden />
          Cycles
        </Link>
      </nav>
      <header className="px-5 pt-1.5 laptop:px-0 laptop:pt-0">
        <Link prefetch={false} href="/app/cycles" className="hidden text-[14px] text-signal-ink laptop:block">
          ‹ Cycles
        </Link>
        <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.03em]">Templates</h1>
        <p className="mt-1 max-w-[560px] text-[15px] leading-[22px] text-ink-2">
          Starting points the team maintains. Choosing one opens the builder with a copy that&apos;s yours to adjust; later template changes won&apos;t touch it.
        </p>
      </header>
      {templates.length ? (
        <Group className="mx-3 mt-5 laptop:mx-0 laptop:max-w-[760px]">
          {templates.map((template) => {
            const names = new Map(template.peptides.map((peptide) => [peptide.id, peptide]));
            const days = templateDays(template);
            return (
              <Link prefetch={false} key={template.id} href={`/app/cycles/new?template=${template.id}`} className="flex items-center gap-3 py-3 pr-3 pl-4" data-testid="cycle-template">
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">{template.name}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                    {template.plans.map((plan) => names.get(plan.peptideId)?.name ?? "Unknown peptide").join(" · ")}
                  </span>
                  {includesWithdrawn(template, names) ? (
                    <span className="mt-1 block">
                      <Tag tone="outline">{TEMPLATE_CARD_WARNING}</Tag>
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[13px] font-medium text-ink-2">
                  {days} {days === 1 ? "day" : "days"}
                </span>
                <ChevronRight className="size-[18px] shrink-0 text-ink-3" aria-hidden />
              </Link>
            );
          })}
        </Group>
      ) : (
        <p className="mx-5 mt-5 text-[15px] text-ink-2 laptop:mx-0">{NO_TEMPLATES}</p>
      )}
    </main>
  );
}
