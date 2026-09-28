import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { CYCLES_MAIN } from "@/components/research/cycles/cycles-list";

/** Templates loading: the title and the list at its size. */
export default function CycleTemplatesLoading() {
  return (
    <main className={CYCLES_MAIN}>
      <SkeletonRegion label="Loading templates">
        <div className="h-11 laptop:hidden" />
        <header className="px-5 pt-1.5 laptop:px-0">
          <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.03em]">Templates</h1>
          <Skeleton className="mt-2 h-4 w-3/4 rounded-[6px]" />
        </header>
        <Skeleton className="mx-3 mt-5 h-[196px] rounded-group laptop:mx-0 laptop:max-w-[760px]" />
      </SkeletonRegion>
    </main>
  );
}
