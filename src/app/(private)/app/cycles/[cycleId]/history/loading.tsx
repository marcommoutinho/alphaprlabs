import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";

/** The full history loading: the title and rows at their size. */
export default function CycleHistoryLoading() {
  return (
    <main className={CYCLES_MAIN}>
      <SkeletonRegion label="Loading the history">
        <div className="h-11 laptop:hidden" />
        <header className="px-5 pt-1.5 laptop:px-0">
          <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.03em]">History</h1>
          <Skeleton className="mt-2 h-4 w-40 rounded-[6px]" />
        </header>
        <div className="mx-5 mt-4 flex flex-col gap-4 laptop:mx-0">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 rounded-[10px]" />
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}
