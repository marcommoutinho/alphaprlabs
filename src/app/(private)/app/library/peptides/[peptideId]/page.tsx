import { ChevronLeft, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/alpha/button-variants";
import Link from "@/components/alpha/link";
import { NowBlock } from "@/components/alpha/now-block";
import { Tag } from "@/components/alpha/tag";
import { LIBRARY_MAIN } from "@/components/research/library/library-screen";
import { PeptideSections } from "@/components/research/library/peptide-sections";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { getPeptideForDetail } from "@/lib/library/research";
import { type Reading, updatedLabel, yourMix } from "@/lib/library/screen";
import { listMixtures } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Params = Promise<{ peptideId: string }>;

/**
 * R12 Peptide detail (design v3): company content for an entry still
 * offered, or for a withdrawn one when a cycle of the caller's own uses it
 * (opened from that cycle; Marco 2026-09-28). Anyone else, a withdrawn entry
 * is not found (it is not browsable, Marco 2026-09-26). "Your mix" shows
 * only when one of the caller's own current cycles uses the peptide: that
 * plan's saved mixture and dose through the calculator. "Add to a cycle"
 * opens the builder with the peptide checked; a withdrawn entry can't start
 * a new cycle, so it has none.
 */
export default async function PeptidePage({ params }: { params: Params }) {
  const { peptideId } = await params;
  const person = await requireResearcher(`/app/library/peptides/${encodeURIComponent(peptideId)}`);
  const db = await createClient();
  const peptide = await getPeptideForDetail(db, person.id, peptideId);
  if (!peptide) notFound();
  const [cycles, mixtures] = await Promise.all([listCycles(db, person.id), listMixtures(db, person.id)]);
  const mine = yourMix(peptide.id, cycles, mixtures, new Date());

  return (
    <main className={LIBRARY_MAIN}>
      <div className="laptop:max-w-[760px]">
        <nav aria-label="Peptide" className="flex h-11 items-center pl-1.5 text-[17px] text-signal-ink laptop:hidden">
          <Link href="/app/library" className="flex h-11 items-center gap-0.5">
            <ChevronLeft className="size-[26px]" aria-hidden />
            Library
          </Link>
        </nav>
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Link href="/app/library" className="hidden text-[14px] text-signal-ink laptop:block">
            ‹ Library
          </Link>
          <div className="font-mono text-[13px] font-medium text-ink-3 laptop:mt-1">{updatedLabel(peptide.updatedAt)}</div>
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em] break-words">{peptide.name}</h1>
          {peptide.available ? null : (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-ink-2" data-testid="peptide-withdrawn">
              <Tag tone="outline">Not offered</Tag>
              No longer in the library. It stays in the cycles that use it.
            </p>
          )}
        </header>

        {mine ? (
          <div className="mx-3 mt-[18px] laptop:mx-0">
            <NowBlock aria-label="Your mix" data-testid="your-mix">
              <div className="flex items-baseline justify-between gap-3 text-[13px] text-on-ink-2">
                <span className="min-w-0 truncate">{mine.mix ? `Your mix · ${mine.mix}` : "Your dose · no mix saved"}</span>
                {mine.syringe ? <span className="shrink-0 font-mono text-[12px] font-medium">{mine.syringe}</span> : null}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 pb-0.5">
                <MixReading term="Strength" reading={mine.strength} />
                <MixReading term="Your dose" reading={mine.dose} />
                <MixReading term="Draw" reading={mine.draw} />
              </dl>
            </NowBlock>
            <p className="mt-2 px-2 text-[13px] text-ink-3">
              From{" "}
              <Link href={`/app/cycles/${mine.cycleId}`} className="font-semibold text-signal-ink">
                {mine.cycleName}
              </Link>
              {mine.mix ? "" : ". Save a mix in the cycle to see the draw."}
            </p>
          </div>
        ) : null}

        <PeptideSections peptide={peptide} />

        {peptide.available ? (
          <div className="mx-3 mt-6 laptop:mx-0">
            <Link
              href={`/app/cycles/new?peptide=${peptide.id}`}
              className={cn(buttonVariants({ variant: "ink", size: "lg", block: true }), "laptop:w-auto")}
              data-testid="add-to-cycle"
            >
              <Plus className="size-5" aria-hidden />
              Add to a cycle
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function MixReading({ term, reading }: { term: string; reading: Reading | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-on-ink-2">{term}</dt>
      <dd className="mt-1 truncate">
        {reading ? (
          <>
            <span className="text-[26px] font-semibold tracking-[-0.02em]">{reading.value}</span>{" "}
            <span className="font-mono text-[13px] text-on-ink-2">{reading.unit}</span>
          </>
        ) : (
          <span className="text-[26px] font-semibold tracking-[-0.02em] text-on-ink-2">—</span>
        )}
      </dd>
    </div>
  );
}
