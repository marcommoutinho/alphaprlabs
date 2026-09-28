import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";

/** R3 / D2 loading: the header, the Now block with its ruler, the tiles and a peptide card at their size. */
export default function CycleLoading() {
  return (
    <main className={CYCLES_MAIN}>
      <SkeletonRegion label="Loading the cycle">
        <div className="h-11 laptop:hidden" />
        <header className="px-5 pt-1.5 laptop:px-0">
          <Skeleton className="h-4 w-40 rounded-[6px]" />
          <Skeleton className="mt-2 h-9 w-2/3 rounded-[10px]" />
        </header>
        <div className="mt-[18px] px-3 laptop:grid laptop:grid-cols-12 laptop:gap-4 laptop:px-0">
          <Skeleton className="flex h-[196px] flex-col justify-end gap-4 rounded-now p-5 laptop:col-span-9 laptop:h-[150px] laptop:rounded-[24px]">
            <Skeleton inner className="h-16 w-1/3" />
            <Skeleton inner className="h-[30px]" />
          </Skeleton>
          <div className="mt-3 grid grid-cols-[1.3fr_1fr_1fr] gap-2 laptop:col-span-3 laptop:mt-0 laptop:grid-cols-1">
            <Skeleton className="h-[100px] rounded-group laptop:h-auto" />
            <Skeleton className="h-[100px] rounded-group laptop:h-auto" />
            <Skeleton className="h-[100px] rounded-group laptop:hidden" />
          </div>
        </div>
        <Skeleton className="mx-3 mt-7 h-[230px] rounded-[24px] laptop:mx-0" />
      </SkeletonRegion>
    </main>
  );
}
