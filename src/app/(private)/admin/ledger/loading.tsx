import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BUSINESS_MAIN } from "@/components/business/frame";

/** Ledger loading (§7.16): the title at once; the controls, a day header and its rows at their real size. */
export default function LedgerLoading() {
  return (
    <main className={BUSINESS_MAIN}>
      <SkeletonRegion label="Loading the ledger">
        <div className="h-11 laptop:hidden" />
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Skeleton className="hidden h-4 w-36 rounded-[6px] laptop:block" />
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:hidden">Ledger</h1>
          <h1 className="hidden text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:mt-0.5 laptop:block">Sales and purchases</h1>
        </header>
        <div className="mx-3 mt-3.5 flex flex-col gap-2.5 laptop:mx-0 laptop:mt-4">
          <Skeleton className="h-11 laptop:h-10 laptop:w-[260px]" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 rounded-[12px]" />
            <Skeleton className="h-9 w-28 rounded-[12px]" />
          </div>
        </div>
        <Skeleton className="mx-5 mt-5 h-4 w-40 rounded-[6px] laptop:mx-0" />
        <Skeleton className="mx-3 mt-2 h-[196px] rounded-[20px] laptop:mx-0 laptop:h-[320px]" />
      </SkeletonRegion>
    </main>
  );
}
