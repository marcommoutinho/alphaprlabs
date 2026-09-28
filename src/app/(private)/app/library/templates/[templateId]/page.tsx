import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/alpha/button-variants";
import Link from "@/components/alpha/link";
import { Group } from "@/components/alpha/list";
import { Tag } from "@/components/alpha/tag";
import { LIBRARY_MAIN } from "@/components/research/library/library-screen";
import { requireResearcher } from "@/lib/auth/session";
import { getResearchTemplate } from "@/lib/library/research";
import { phaseText, phaseWhen, TEMPLATE_INTRO, templateDays, WITHDRAWN_NOTE } from "@/lib/library/research-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Params = Promise<{ templateId: string }>;

/**
 * A supplied template (design v3 styling): what a copy would receive, and
 * "Use as starting point" into the builder. Not blocked by a peptide no
 * longer offered (Marco, 2026-09-26): the copy keeps it, and it shows here
 * by name with the builder's note. Templates are browsed from Cycles ›
 * Templates.
 */
export default async function TemplatePage({ params }: { params: Params }) {
  const { templateId } = await params;
  await requireResearcher(`/app/library/templates/${encodeURIComponent(templateId)}`);
  const db = await createClient();
  const template = await getResearchTemplate(db, templateId);
  if (!template) notFound();
  const peptides = new Map(template.peptides.map((peptide) => [peptide.id, peptide]));
  const days = templateDays(template);

  return (
    <main className={LIBRARY_MAIN}>
      <div className="laptop:max-w-[760px]">
        <nav aria-label="Template" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
          <Link href="/app/cycles/templates" className="flex h-11 items-center gap-0.5">
            <ChevronLeft className="size-[26px]" aria-hidden />
            Templates
          </Link>
        </nav>
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Link href="/app/cycles/templates" className="hidden text-[14px] text-signal-ink laptop:block">
            ‹ Templates
          </Link>
          <div className="font-mono text-[13px] font-medium text-ink-3 laptop:mt-1">
            Template · {days} {days === 1 ? "day" : "days"}
          </div>
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em] break-words">{template.name}</h1>
          <p className="mt-1 text-[15px] leading-[22px] text-ink-2">{TEMPLATE_INTRO}</p>
        </header>
        <div className="mt-5 flex flex-col gap-4">
          {template.plans.map((plan) => {
            const peptide = peptides.get(plan.peptideId);
            return (
              <section key={plan.peptideId} data-testid="template-plan">
                <h2 className="mx-5 flex items-center gap-2 text-[17px] font-semibold laptop:mx-0">
                  {peptide?.name ?? "Unknown peptide"}
                  {peptide && !peptide.available ? <Tag tone="outline">{WITHDRAWN_NOTE}</Tag> : null}
                </h2>
                <Group className="mx-3 mt-2 laptop:mx-0">
                  {plan.phases.map((phase, index) => (
                    <div key={index} className="flex items-baseline justify-between gap-4 px-4 py-3">
                      <span className="shrink-0 font-mono text-[13px] font-medium text-ink-2">{phaseWhen(phase)}</span>
                      <span className="text-right text-[15px]">{phaseText(phase)}</span>
                    </div>
                  ))}
                </Group>
              </section>
            );
          })}
        </div>
        {template.guidance ? (
          <section className="mx-5 mt-6 laptop:mx-0">
            <h2 className="text-[20px] font-semibold tracking-[-0.015em]">Guidance</h2>
            <p className="mt-2.5 text-base leading-[24px] break-words whitespace-pre-line">{template.guidance}</p>
          </section>
        ) : null}
        <div className="mx-3 mt-6 laptop:mx-0">
          <Link href={`/app/cycles/new?template=${template.id}`} className={cn(buttonVariants({ variant: "ink", size: "lg", block: true }), "laptop:w-auto")}>
            Use as starting point
          </Link>
        </div>
      </div>
    </main>
  );
}
