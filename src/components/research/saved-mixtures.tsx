import { ChevronRight } from "lucide-react";
import Link from "@/components/alpha/link";
import { Button } from "@/components/alpha/button";
import type { LinkablePlan } from "@/lib/mixtures/plans";
import { type Mixture, mixtureDetail, mixtureLabel, NO_MIXTURES } from "@/lib/mixtures/rules";

/** R7 "Saved mixtures": each with its concentration, spacing and use, Load and Delete (a grouped list, §7.5). */
export function SavedMixtures({
  mixtures,
  plans,
  trackedVials,
  nameOf,
  busy,
  onLoad,
  onDelete,
}: {
  mixtures: Mixture[];
  plans: LinkablePlan[];
  trackedVials: Record<string, string>;
  nameOf: (peptideId: string) => string;
  busy: boolean;
  onLoad: (mixture: Mixture) => void;
  onDelete: (mixture: Mixture) => void;
}) {
  return (
    <section aria-labelledby="saved-mixtures" className="mt-3">
      <div className="flex items-baseline justify-between gap-3 px-2 laptop:px-0">
        <h2 id="saved-mixtures" className="text-[20px] leading-6 font-semibold tracking-[-0.015em]">
          Saved mixtures
        </h2>
        <Link href="/app/supplies" className="flex shrink-0 items-center text-[15px] font-semibold text-signal-ink">
          Personal supplies
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      {mixtures.length === 0 ? (
        <p className="mt-3 px-2 text-[15px] leading-5 text-ink-2 laptop:px-0">{NO_MIXTURES}</p>
      ) : (
        <div className="mt-3 divide-y divide-line overflow-hidden rounded-group border border-line bg-surface">
          {mixtures.map((mixture) => {
            const usedBy = plans.filter((plan) => plan.mixtureId === mixture.id).map((plan) => plan.cycleName);
            return (
              <div key={mixture.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-testid="saved-mixture">
                <div className="min-w-0 flex-1 basis-[220px]">
                  <div className="text-[16px] leading-[22px] font-semibold break-words">{mixtureLabel(nameOf(mixture.peptideId), mixture.setup)}</div>
                  <div className="mt-0.5 font-mono text-[12px] leading-4 break-words text-ink-2">
                    {mixtureDetail(mixture.setup, usedBy, trackedVials[mixture.id])}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="soft" size="sm" onClick={() => onLoad(mixture)}>
                    Load
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} needsConnection onClick={() => onDelete(mixture)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
