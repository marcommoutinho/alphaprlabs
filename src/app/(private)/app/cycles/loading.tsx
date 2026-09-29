import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";

/** R10 loading: the real title, then an active card, an upcoming card and the ended group at their size. */
export default function CyclesLoading() {
  return (
    <main className={CYCLES_MAIN}>
      <SkeletonRegion label="Loading your cycles">
        <header className="flex items-end justify-between pt-2 pr-3 pl-5 laptop:px-0">
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Cycles</h1>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-[122px] rounded-[12px]" />
            <Skeleton className="size-11 rounded-full" />
          </div>
        </header>
        <Skeleton className="mx-5 mt-6 h-4 w-16 rounded-[6px] laptop:mx-0" />
        <div className="mx-3 mt-2 grid gap-2.5 laptop:mx-0 laptop:grid-cols-2 laptop:gap-4">
          <Skeleton className="flex h-[196px] flex-col justify-center gap-3 rounded-[24px] p-4">
            <Skeleton inner className="h-5 w-2/3" />
            <Skeleton inner className="h-[22px]" />
          </Skeleton>
          <Skeleton className="h-[78px] rounded-[24px]" />
        </div>
        <Skeleton className="mx-5 mt-6 h-4 w-16 rounded-[6px] laptop:mx-0" />
        <Skeleton className="mx-3 mt-2 h-[132px] rounded-group laptop:mx-0 laptop:max-w-[760px]" />
      </SkeletonRegion>
    </main>
  );
}
