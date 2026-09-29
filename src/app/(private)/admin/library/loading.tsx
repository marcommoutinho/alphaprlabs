import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BackBar, SkeletonRows } from "@/components/admin/states";

/** A8 / D6 · loading: the title at once, the control and search, then rows at real height. */
export default function LibraryLoading() {
  return (
    <div className="flex w-full flex-col laptop:grid laptop:grid-cols-[360px_minmax(0,1fr)]">
      <section className="flex flex-col laptop:min-h-dvh laptop:border-r laptop:border-line">
        <BackBar href="/admin/business" label="Business" />
        <SkeletonRegion label="Loading the library">
          <header className="px-5 pt-1 laptop:pt-6">
            <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:text-[28px]">Library</h1>
            <Skeleton className="mt-3.5 h-11 rounded-[12px] laptop:mt-3 laptop:h-[38px]" />
          </header>
          <Skeleton className="mx-3 mt-3.5 h-11 rounded-[12px] laptop:mx-5 laptop:mt-3 laptop:h-[38px]" />
          <SkeletonRows className="mx-3 mt-4 laptop:mx-2.5" />
        </SkeletonRegion>
      </section>
    </div>
  );
}
