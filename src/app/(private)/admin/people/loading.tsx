import { Skeleton, SkeletonRegion } from "@/components/alpha/skeleton";
import { BackBar, SkeletonRows } from "@/components/admin/states";

/** A11 / D8 · loading: the title at once, then the invite and rows at real height. */
export default function PeopleLoading() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col pb-24 laptop:px-9 laptop:pt-7">
      <BackBar href="/admin/business" label="Business" />
      <SkeletonRegion label="Loading people">
        <header className="px-5 pt-1 laptop:px-0 laptop:pt-0">
          <Skeleton className="hidden h-4 w-[190px] rounded-[4px] laptop:block" />
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] laptop:mt-0.5">People</h1>
        </header>
        <div className="laptop:mt-5 laptop:grid laptop:grid-cols-[320px_minmax(0,1fr)] laptop:gap-4">
          <Skeleton className="mx-3 mt-3.5 h-[52px] rounded-[14px] laptop:mx-0 laptop:mt-0 laptop:h-[380px] laptop:rounded-group" />
          <SkeletonRows className="mx-3 mt-7 laptop:mx-0 laptop:mt-0" count={7} />
        </div>
      </SkeletonRegion>
    </main>
  );
}
