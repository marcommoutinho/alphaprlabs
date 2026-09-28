import { ChevronLeft, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/alpha/button-variants";
import Link from "@/components/alpha/link";
import { NowBlock } from "@/components/alpha/now-block";
import { LIBRARY_MAIN } from "@/components/research/library/library-screen";
import { requireResearcher } from "@/lib/auth/session";
import { listCycles } from "@/lib/cycles/service";
import { getAvailablePeptide } from "@/lib/library/research";
import { type Reading, SECTION_EMPTY, updatedLabel, yourMix } from "@/lib/library/screen";
import { listMixtures } from "@/lib/mixtures/service";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type Params = Promise<{ peptideId: string }>;

/**
 * R12 Peptide detail (design v3): company content for an entry still
 * offered (a withdrawn entry is not browsable, Marco 2026-09-26, so it is
 * not found here; cycles that use it still show it). "Your mix" shows only
 * when one of the caller's own current cycles uses the peptide: that
 * plan's saved mixture and dose through the calculator. "Add to a cycle"
 * opens the builder with the peptide checked.
 */
export default async function PeptidePage({ params }: { params: Params }) {
  const { peptideId } = await params;
  const person = await requireResearcher(`/app/library/peptides/${encodeURIComponent(peptideId)}`);
  const db = await createClient();
  const peptide = await getAvailablePeptide(db, peptideId);
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

        <div className="mx-5 mt-7 flex flex-col gap-6 laptop:mx-0">
          <Section title="Research summary" text={peptide.information} empty={SECTION_EMPTY.summary} testId="peptide-summary" />
          <Section title="Cycling off" text={peptide.cyclingOff} empty={SECTION_EMPTY.cyclingOff} testId="peptide-cycling-off" />
          <Section title="Supporting supplements" text={peptide.supplement} empty={SECTION_EMPTY.supplement} testId="peptide-supplements">
            {peptide.supplement ? (
              <p className="mt-2 text-[13px] leading-[19px] text-ink-3">
                Reading this doesn&apos;t start anything.{" "}
                <Link href="/app/supplements" className="font-semibold text-signal-ink">
                  Create a supplement routine
                </Link>{" "}
                if you want reminders.
              </p>
            ) : null}
          </Section>
        </div>

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

function Section({ title, text, empty, testId, children }: { title: string; text: string; empty: string; testId: string; children?: React.ReactNode }) {
  return (
    <section data-testid={testId}>
      <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
      {text ? (
        <p className="mt-2.5 text-base leading-[24px] break-words whitespace-pre-line text-ink">{text}</p>
      ) : (
        <p className="mt-2.5 text-[15px] leading-[22px] text-ink-3">{empty}</p>
      )}
      {children}
    </section>
  );
}
