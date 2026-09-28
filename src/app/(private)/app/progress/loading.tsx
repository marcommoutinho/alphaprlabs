import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";

/** R5 loading: the real title, then the Now block, the measurement card, the tiles and the rows at their size. */
export default function ProgressLoading() {
  return (
    <main className={CYCLES_MAIN}>
      <SkeletonRegion label="Loading your progress">
        <header className="px-5 pt-2 laptop:px-0">
          <Skeleton className="h-4 w-40 rounded-[6px]" />
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Progress</h1>
          <Skeleton className="mt-3.5 h-11 laptop:hidden" />
        </header>
        <div className="mt-4 flex flex-col gap-3 px-3 laptop:grid laptop:grid-cols-12 laptop:gap-4 laptop:px-0">
          <Skeleton className="h-[300px] rounded-now laptop:col-span-8 laptop:h-[330px] laptop:rounded-[24px]" />
          <div className="flex flex-col gap-3 laptop:col-span-4">
            <Skeleton className="h-[210px] rounded-[24px]" />
            <div className="grid grid-cols-3 gap-2 laptop:grid-cols-2">
              <Skeleton className="h-[98px] rounded-group" />
              <Skeleton className="h-[98px] rounded-group" />
              <Skeleton className="h-[98px] rounded-group laptop:hidden" />
            </div>
          </div>
          <Skeleton className="mt-4 h-[220px] rounded-group laptop:col-span-8 laptop:mt-0" />
        </div>
      </SkeletonRegion>
    </main>
  );
}
