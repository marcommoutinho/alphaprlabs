import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { LIBRARY_MAIN } from "@/components/research/library/library-screen";

/** R12 loading: the title, the mix block and the content sections at their size. */
export default function Loading() {
  return (
    <main className={LIBRARY_MAIN}>
      <SkeletonRegion label="Loading the peptide" className="laptop:max-w-[760px]">
        <div className="h-11 laptop:hidden" />
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Skeleton className="h-4 w-44 rounded-[6px]" />
          <Skeleton className="mt-2 h-9 w-52 rounded-[8px]" />
        </header>
        <Skeleton className="mx-3 mt-[18px] h-[118px] rounded-now laptop:mx-0" />
        <div className="mx-5 mt-7 flex flex-col gap-6 laptop:mx-0">
          {[120, 72, 72].map((height, index) => (
            <div key={index}>
              <Skeleton className="h-6 w-44 rounded-[6px]" />
              <Skeleton className="mt-2.5 rounded-[14px]" style={{ height }} />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}
