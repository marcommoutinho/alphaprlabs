import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { LIBRARY_MAIN } from "@/components/research/library/library-screen";

/** R11 loading: the real title, then the search, the chips and the list at their size. */
export default function Loading() {
  return (
    <main className={LIBRARY_MAIN}>
      <SkeletonRegion label="Loading the library" className="laptop:max-w-[760px]">
        <header className="px-5 pt-2 laptop:px-0 laptop:pt-0">
          <Skeleton className="h-4 w-48 rounded-[6px]" />
          <h1 className="mt-0.5 text-[34px] leading-[1.15] font-semibold tracking-[-0.03em]">Library</h1>
        </header>
        <Skeleton className="mx-3 mt-3.5 h-11 rounded-[12px] laptop:mx-0" />
        <div className="mx-3 mt-3 flex gap-1.5 laptop:mx-0">
          <Skeleton className="h-9 w-12 rounded-[10px]" />
          <Skeleton className="h-9 w-32 rounded-[10px]" />
        </div>
        <Skeleton className="mx-3 mt-3.5 h-[336px] rounded-group laptop:mx-0" />
      </SkeletonRegion>
    </main>
  );
}
